import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test'

import { register } from '../hooks/register.tsx'

type Handler = (...args: any[]) => any

const handlers = new Map<string, Handler>()
register(((event: string, ...rest: Handler[]) => handlers.set(event, rest.at(-1)!)) as any, {} as any)

let sessions = 0

type Scenario = { model: string; contextTokens: number }

function engine(scenario: Scenario, verdict: { model: string; effort?: string }) {
  const sessionId = `s${++sessions}`
  const files = new Map<string, string>()
  const statuses: string[] = []
  const $: any = {
    env: { get: async (key: string) => ({ HOME: '/home/t', OPENROUTER_API_KEY: 'k' })[key] },
    fs: {
      read: async (path: string) => {
        if (files.has(path)) return files.get(path)
        throw new Error('ENOENT')
      },
      write: async (path: string, text: string) => void files.set(path, text),
    },
    session: {
      id: async () => sessionId,
      cwd: async () => '/repo',
      model: async () => scenario.model,
      usage: async () => ({ context: { tokens: scenario.contextTokens } }),
    },
    process: { run: async () => ({ stdout: 'git@github-personal:mxttbennett/x.git', exitCode: 0 }) },
    http: {
      fetch: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({
          answers: {
            placement: { choice: 'inline', confidence: 0.9 },
            model_choice: { choice: verdict.model },
            effort_choice: { choice: verdict.effort ?? 'low' },
          },
        }),
      }),
    },
    clock: { after: () => {} },
    ui: { status: () => {}, log: (text: string) => void statuses.push(text) },
  }
  const records = () =>
    [...files.entries()]
      .filter(([path]) => path.includes('/mod/'))
      .flatMap(([, text]) => text.split('\n').filter(Boolean).map(line => JSON.parse(line)))
  return { $, records, scenario, statuses }
}

async function startSession($: any) {
  await handlers.get('session.start')!($, {}, async (e: unknown) => e)
}

async function typedTurn($: any, text: string, turnId: string, seen: { step?: any } = {}) {
  await handlers.get('prompt.submit')!($, { text, origin: { kind: 'composer' } }, async (e: unknown) => e)
  await handlers.get('turn.start')!($, { text, turnId }, async (e: unknown) => e)
  const next = (e: any) => {
    seen.step = e
    const stream = (async function* () {
      yield { kind: 'stop', usage: { model: 'claude-served', input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, output_tokens: 5 } }
    })()
    return Object.assign(stream, { result: Promise.resolve('done') })
  }
  const run = handlers.get('turn.step')!($, { turnId, index: 0, effort: 'high' }, next)
  for await (const _ of run) void _
  await handlers.get('turn.complete')!($, { turnId }, async (e: unknown) => e)
  return seen.step
}

const applied = (records: () => any[]) => records().filter(r => r.event === 'applied').at(-1)

beforeEach(() => setSystemTime())

describe('inline switching in the mod', () => {
  test('blocks a downgrade on a warm large context', async () => {
    // Arrange
    const { $, records, statuses } = engine({ model: 'opus', contextTokens: 80_000 }, { model: 'haiku' })
    await startSession($)
    // Act
    const step = await typedTurn($, 'rename the variable', 't1')
    // Assert
    expect(step.model).toBeUndefined()
    expect(applied(records)).toMatchObject({ switched: false, downgrade: false, downgradeBlocked: true })
    expect(statuses).toEqual(['jev: staying on opus · haiku skipped, 80k context is cached · low · 0.90'])
  })

  test('applies a downgrade on a small context and records cache creation tokens', async () => {
    // Arrange
    const { $, records, statuses } = engine({ model: 'opus', contextTokens: 5_000 }, { model: 'haiku' })
    await startSession($)
    // Act
    const step = await typedTurn($, 'rename the variable', 't1')
    // Assert
    expect(statuses).toEqual(['jev → haiku · low · 0.90'])
    expect(step.model).toBe('haiku')
    expect(applied(records)).toMatchObject({ switched: true, downgrade: true, downgradeBlocked: false, cacheCreationTokens: 40 })
  })

  test('applies an upgrade on a warm large context', async () => {
    // Arrange
    const { $, records } = engine({ model: 'sonnet', contextTokens: 80_000 }, { model: 'opus' })
    await startSession($)
    // Act
    const step = await typedTurn($, 'redesign the cache layer', 't1')
    // Assert
    expect(step.model).toBe('opus')
    expect(applied(records)).toMatchObject({ switched: true, downgrade: false, downgradeBlocked: false })
  })

  test('applies a downgrade once the cache has gone cold', async () => {
    // Arrange
    const { $, records } = engine({ model: 'opus', contextTokens: 80_000 }, { model: 'haiku' })
    await startSession($)
    setSystemTime(new Date('2026-11-06T10:00:00Z'))
    await typedTurn($, 'first question', 't1')
    setSystemTime(new Date('2026-11-06T10:06:00Z'))
    // Act
    const step = await typedTurn($, 'rename the variable', 't2')
    // Assert
    expect(step.model).toBe('haiku')
    expect(applied(records)).toMatchObject({ downgrade: true, downgradeBlocked: false })
  })
})

describe('regret logging in the mod', () => {
  async function afterDowngrade() {
    const made = engine({ model: 'opus', contextTokens: 5_000 }, { model: 'haiku' })
    await startSession(made.$)
    await typedTurn(made.$, 'rename the variable', 't1')
    return made
  }

  test('logs regret when the prompt after a downgrade is a correction', async () => {
    // Arrange
    const { $, records } = await afterDowngrade()
    // Act
    await typedTurn($, 'no, try again', 't2')
    // Assert
    expect(records().filter(r => r.event === 'regret')).toHaveLength(1)
  })

  test('logs no regret for a follow-up that is not a correction', async () => {
    // Arrange
    const { $, records } = await afterDowngrade()
    // Act
    await typedTurn($, 'now add a test', 't2')
    // Assert
    expect(records().filter(r => r.event === 'regret')).toHaveLength(0)
  })

  test('clears the downgrade flag after one prompt', async () => {
    // Arrange
    const { $, records, scenario } = await afterDowngrade()
    scenario.contextTokens = 80_000
    await typedTurn($, 'now add a test', 't2')
    // Act
    await typedTurn($, 'no, that is wrong', 't3')
    // Assert
    expect(records().filter(r => r.event === 'regret')).toHaveLength(0)
  })

  test('a new session forgets the previous downgrade', async () => {
    // Arrange
    const { $, records } = await afterDowngrade()
    await startSession($)
    // Act
    await typedTurn($, 'no, try again', 't2')
    // Assert
    expect(records().filter(r => r.event === 'regret')).toHaveLength(0)
  })
})
