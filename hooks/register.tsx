import type { EngineInterface, Register } from 'claude-code'

import { isEnabled, resolveConfig } from '../src/defaults.mjs'
import { parseEnv } from '../src/envfile.mjs'
import { createProviders } from '../src/providers.mjs'
import { decisionLabel, isChange, notifyCommand, titleFromTranscript } from '../src/notify.mjs'
import { classify } from '../src/relay.mjs'

type Effort = 'low' | 'medium' | 'high'
type Decision = { placement: string; model: string | null; effort: Effort | null; confidence: number | null }
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
  byText: new Map<string, Promise<Decision | null>>(),
  spawned: new Set<string>(),
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

const isUnavailable = (err: unknown) => err instanceof TypeError || /unavailable|not available|CLI|ENOENT|failed to start/i.test(String(err))

const TYPED_ORIGINS = ['composer', 'bridge', 'sdk']
const RESULT_PREFIX = 'jev-relay: the subagent finished.'
const EFFORTS = ['low', 'medium', 'high', 'xhigh']
const TIERS = ['haiku', 'sonnet', 'opus']
const tierOf = (model: string) => TIERS.find(tier => model.toLowerCase().includes(tier)) ?? model.toLowerCase()
const isAlias = (model: string) => TIERS.includes(model.toLowerCase())
const isSameModel = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return x === y || (isAlias(x) && y.includes(x)) || (isAlias(y) && x.includes(y))
}

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

async function notify($: EngineInterface, message: string) {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const id = await $.session.id()
  const transcript = `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
  const title = titleFromTranscript((await $.fs.read(transcript).catch(() => '')).slice(-1_000_000))
  const [cmd, ...args] = notifyCommand(message, title || 'jev-relay')
  await $.process.run([cmd, ...args], { timeoutMs: 3000 }).catch(() => {})
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
  if (result.heuristic || (!result.verdict.model && !result.verdict.effort)) return null
  const changed = isChange(state.latest, result.verdict)
  state.latest = result.verdict
  if (state.config.macNotifications && changed) void notify($, decisionLabel(result.verdict))
  const confidence = result.verdict.confidence == null ? '' : ` · ${result.verdict.confidence.toFixed(2)}`
  const label = [result.verdict.model, result.verdict.effort].filter(Boolean).join(' · ')
  if (state.config.statusNotice) await $.ui.status(`jev → ${label}${confidence}`)
  return result.verdict
}

async function spawnSibling($: EngineInterface, prompt: string, model: string) {
  const cwd = await $.session.cwd()
  try {
    const ran = await $.process.run(['claude', '--bg', '--model', model, prompt], { cwd, timeoutMs: 30_000 })
    return ran.exitCode === 0
  } catch (err) {
    if (!isUnavailable(err)) return false
  }
  try {
    const started = await $.agent.spawn({ prompt, model, subagentType: 'general-purpose', name: 'jev-sibling', description: 'Handoff from jev-relay', cwd })
    if ('agentId' in started) state.spawned.add(started.agentId)
    return 'agentId' in started
  } catch {
    return false
  }
}

async function act($: EngineInterface, prompt: string, decision: Decision): Promise<string | null> {
  const model = decision.model ?? 'sonnet'
  if (decision.placement === 'subagent') {
    const started = await $.agent.spawn({ prompt, model, subagentType: 'general-purpose', description: 'Handoff from jev-relay' }).catch(() => null)
    if (started && 'agentId' in started) {
      state.spawned.add(started.agentId)
      return `jev-relay: a subagent (${started.model}) is already working on the user's request. Reply with one short sentence saying so and stop; its result arrives when it finishes.`
    }
    return `jev-relay: delegate this request to a subagent (model ${model}) with the Agent tool, using Explore for read-only searches. Do not do the work in this conversation.`
  }
  if (decision.placement !== 'sibling') return null

  const answer = await $.ui.ask(`Run this in a background session (${model})?`, { options: ['Keep here', 'Run in background'], header: 'jev-relay' })
  if (answer !== 'Run in background' || !(await spawnSibling($, prompt, model))) return null
  return `jev-relay: the user's request was handed to a background session (${model}). Reply with one short sentence saying so and stop; do not do the work here.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    state.baseline = await $.session.model()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || state.isManual || !isOn() || e.text.trim() === '' || e.text.includes(RESULT_PREFIX)) return result

    const sessionModel = await $.session.model()
    if (sessionModel !== state.baseline) {
      state.isManual = true
      await publish($, { manual: true })
      return result
    }
    state.pending.set(e.turnId, state.byText.get(e.text) ?? decide($, e.text).catch(() => null))
    state.byText.delete(e.text)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!TYPED_ORIGINS.includes(e.origin.kind) || e.command || state.isManual || !isOn() || e.text.trim() === '' || e.text.includes(RESULT_PREFIX)) return next(e)

    const pending = decide($, e.text).catch(() => null)
    state.byText.set(e.text, pending)
    const deadline = new Promise<undefined>(resolve => $.clock.after(DEADLINE_MS, () => resolve(undefined)))
    const decision = await Promise.race([pending, deadline])
    const directive = decision ? await act($, e.text, decision).catch(() => null) : null
    return next(directive ? { ...e, context: [...(e.context ?? []), directive] } : e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || state.isManual) return yield* next(e)
    if (!isOn()) {
      if (e.index === 0) void publish($, {})
      return yield* next(e)
    }

    const deadline = new Promise<undefined>(resolve => $.clock.after(DEADLINE_MS, () => resolve(undefined)))
    const decision = await Promise.race([state.pending.get(e.turnId), deadline])
    const current = await $.session.model().catch(() => null)
    if (current === null) return yield* next(e)
    if (current !== state.baseline) {
      state.isManual = true
      return yield* next(e)
    }
    const picked = decision?.placement === 'inline' ? decision.model : null
    const model = picked && !isSameModel(picked, current) ? picked : null
    const wanted = decision?.placement === 'inline' ? decision.effort : null
    const effort = wanted && EFFORTS.includes(wanted) && e.effort !== undefined ? wanted : null
    const stream = next(model || effort ? { ...e, ...(model && { model }), ...(effort && { effort }) } : e)
    for await (const chunk of stream) {
      if (e.index === 0 && chunk.kind === 'stop') {
        const served = chunk.usage?.model
        if (picked && served) void publish($, { tier: tierOf(served), model: served, effort })
      }
      yield chunk
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    state.pending.delete(e.turnId)
    if (e.agentId && state.spawned.delete(e.agentId) && e.answer) {
      void $.prompt.submit({ text: `${RESULT_PREFIX} Its result:\n\n${e.answer}\n\nTell the user what it found.` })
    }
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
