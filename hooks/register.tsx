import type { EngineInterface, Register } from 'claude-code'

import { isEnabled, resolveConfig } from '../src/defaults.mjs'
import { parseEnv } from '../src/envfile.mjs'
import { createProviders } from '../src/providers.mjs'
import { classify } from '../src/relay.mjs'

type Decision = { placement: string; model: string | null; confidence: number | null }
type Vars = Record<string, string | undefined>

const DEADLINE_MS = 4000
const TURN_CHARS = 1500

const state = {
  config: resolveConfig(),
  env: {} as Vars,
  jevEnv: {} as Vars,
  baseline: null as string | null,
  isManual: false,
  latest: null as Decision | null,
  pending: new Map<string, Promise<Decision | null>>(),
  directive: null as string | null,
}

const fetchLike =
  ($: EngineInterface) =>
  async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }) => {
    const timeout = new Promise<never>((_, reject) => $.clock.after(init.timeoutMs, () => reject(new Error('timeout'))))
    const res = await Promise.race([$.http.fetch(url, { method: init.method, headers: init.headers, body: init.body }), timeout])
    return { ok: res.ok, status: res.status, json: async () => JSON.parse(res.text) }
  }

async function load($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  try {
    state.config = resolveConfig(JSON.parse(await $.fs.read(`${home}/.config/jev-relay/config.json`)))
  } catch {
    state.config = resolveConfig()
  }
  try {
    state.jevEnv = parseEnv(await $.fs.read(`${home}/.config/jev-opus/.env`))
  } catch {
    state.jevEnv = {}
  }
  const real: Vars = {
    JEV_RELAY: await $.env.get('JEV_RELAY'),
    OPENROUTER_API_KEY: await $.env.get('OPENROUTER_API_KEY'),
    TYPESAFE_API_KEY: await $.env.get('TYPESAFE_API_KEY'),
    JEV_API_KEY: await $.env.get('JEV_API_KEY'),
  }
  state.env = Object.fromEntries(Object.entries(real).filter(([, value]) => value))
}

async function remoteOf($: EngineInterface, cwd: string) {
  try {
    const result = await $.process.run(['git', '-C', cwd, 'remote', 'get-url', 'origin'], { timeoutMs: 2000 })
    return result.stdout.trim()
  } catch {
    return ''
  }
}

const isUnavailable = (err: unknown) => err instanceof TypeError || /unavailable|not available|CLI/i.test(String(err))

const isOn = () => isEnabled(state.config, 'claude', state.env)

async function publish($: EngineInterface, status: Record<string, unknown>) {
  try {
    const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
    const id = (await $.session.id()).replace(/[^\w-]/g, '')
    await $.fs.write(`${tmp}/jev-claude/${id}.json`, JSON.stringify(status))
  } catch {
    // The status line is cosmetic and must never interfere with a turn.
  }
}

async function decide($: EngineInterface, prompt: string): Promise<Decision | null> {
  const providers = createProviders(state.config, {
    config: state.config,
    env: state.env,
    fetch: fetchLike($),
    readJevEnv: () => state.jevEnv,
  })
  const cwd = await $.session.cwd()
  const remote = await remoteOf($, cwd)
  const signals = {
    text: `user: ${prompt.slice(0, TURN_CHARS)}`,
    prompt,
    agent: 'claude',
    contextTokens: (await $.session.usage()).context.tokens ?? 0,
    idleMs: 0,
    cwd,
  }
  const { result } = await classify(signals, state.config, { providers, remoteOf: () => remote })
  if (result.heuristic || !result.verdict.model) return null
  state.latest = result.verdict
  const confidence = result.verdict.confidence == null ? '' : ` · ${result.verdict.confidence.toFixed(2)}`
  if (state.config.statusNotice) await $.ui.status(`jev → ${result.verdict.model}${confidence}`)
  return result.verdict
}

async function spawnSibling($: EngineInterface, prompt: string, model: string) {
  const cwd = await $.session.cwd()
  try {
    await $.process.run(['claude', '--bg', '--model', model, prompt], { cwd, timeoutMs: 30_000 })
    return true
  } catch (err) {
    if (!isUnavailable(err)) return false
  }
  try {
    await $.agent.spawn({ prompt, model, name: 'jev-sibling', description: 'Handoff from jev-relay', cwd })
    return true
  } catch {
    return false
  }
}

async function act($: EngineInterface, prompt: string, decision: Decision): Promise<string | null> {
  const model = decision.model ?? 'sonnet'
  if (decision.placement === 'subagent') {
    return `jev-relay: delegate this request to a subagent (model ${model}) with the Agent tool, using Explore for read-only searches. Do not do the work in this conversation.`
  }
  if (decision.placement !== 'sibling') return null

  const answer = await $.ui.ask(`Run this in a background session (${model})?`, { options: ['Run in background', 'Keep here'], header: 'jev-relay' })
  if (answer !== 'Run in background' || !(await spawnSibling($, prompt, model))) return null
  return `jev-relay: the user's request was handed to a background session (${model}). Reply with one short sentence saying so and stop; do not do the work here.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || state.isManual || !isOn() || e.text.trim() === '') return result

    const sessionModel = await $.session.model()
    state.baseline ??= sessionModel
    if (sessionModel !== state.baseline) {
      state.isManual = true
      await publish($, { manual: true })
      return result
    }
    const pending = decide($, e.text).catch(() => null)
    state.pending.set(e.turnId, pending)
    state.directive = null

    const deadline = new Promise<undefined>(resolve => $.clock.after(DEADLINE_MS, () => resolve(undefined)))
    const decision = await Promise.race([pending, deadline])
    if (decision) state.directive = await act($, e.text, decision).catch(() => null)
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!state.directive || !e.tools.includes('Agent')) return result
    return { sections: [...result.sections, { id: 'jev-relay-router:directive', text: state.directive, scope: 'session' as const }] }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || state.isManual || !isOn()) return yield* next(e)

    const deadline = new Promise<undefined>(resolve => $.clock.after(DEADLINE_MS, () => resolve(undefined)))
    const decision = await Promise.race([state.pending.get(e.turnId), deadline])
    const model = decision?.placement === 'inline' ? decision.model : null
    if (e.index === 0) await publish($, model ? { tier: model, model } : {})
    return yield* next(model ? { ...e, model } : e)
  })

  on('turn.complete', async ($, e, next) => {
    state.pending.delete(e.turnId)
    if (!e.agentId) state.directive = null
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.model || !isOn()) return next(e)
    const deadline = new Promise<null>(resolve => $.clock.after(DEADLINE_MS, () => resolve(null)))
    const decision = await Promise.race([decide($, e.prompt).catch(() => null), deadline])
    return next(decision?.model ? { ...e, model: decision.model } : e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const verdict = state.latest
    if (!state.config.band.enabled || !verdict) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const target = verdict.model
    const confidence = verdict.confidence == null ? '' : ` · ${verdict.confidence.toFixed(2)}`
    const isSwitch = target !== null && !(await $.session.model()).toLowerCase().includes(target.toLowerCase())

    return (
      <Box>
        <Text dimColor>
          jev: {verdict.placement} · {target ?? 'default'}
          {confidence}{' '}
        </Text>
        {isSwitch && <Button key="model" label={`🟢 Switch to ${target}`} onPress={() => $.command.run({ command: 'model', args: target })} />}
      </Box>
    )
  })
}
