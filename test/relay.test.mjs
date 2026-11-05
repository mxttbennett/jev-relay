import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, merge } from "../src/config.mjs";
import { buildNotice } from "../src/nudge.mjs";
import { handlePrompt as run, pickSubagentModel } from "../src/relay.mjs";

const handlePrompt = async (args) => (await run(args))?.context ?? null;

function setup({ providers, config = DEFAULTS, snapshot, remote = "git@github-personal:mxttbennett/x.git" } = {}) {
  const store = new Map();
  const logs = [];
  const deps = {
    env: {},
    now: () => 1_000_000,
    remoteOf: () => remote,
    readTranscript: () => snapshot ?? { contextTokens: 150000, lastAt: 1_000_000, turns: [] },
    providers,
    state: {
      load: (id) => structuredClone(store.get(id) ?? {}),
      save: (id, s) => store.set(id, structuredClone(s)),
      log: (e) => logs.push(e),
    },
  };
  return { deps, store, logs, config };
}

const answer = (verdict, remote = false) => ({ remote, heuristic: false, run: async () => verdict });
const down = (remote = false) => ({ remote, heuristic: false, run: async () => { throw new Error("down"); } });
const heuristics = { remote: false, heuristic: true, run: async () => ({ placement: "inline", model: null, confidence: 0.5 }) };
const priorTurn = { contextTokens: 150000, lastAt: 1_000_000, turns: [{ role: "user", text: "earlier prompt" }] };
const input = { session_id: "s", prompt: "audit the repo", cwd: "/x", transcript_path: "/t" };

test("silent below the gate", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku" }, true), heuristics }, snapshot: { contextTokens: 1000, lastAt: 1_000_000, turns: [] } });
  assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
});

test("nudges to a subagent and caches the model pick", async () => {
  const { deps, config, store } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku", confidence: 0.9 }, true), heuristics } });
  const out = await handlePrompt({ input, agent: "claude", config, deps });
  assert.match(out, /subagent with model haiku/);
  assert.equal(store.get("s").model.value, "haiku");
  assert.equal(await pickSubagentModel({ input: { session_id: "s", tool_input: { prompt: "p" } }, agent: "claude", config, deps }), "haiku");
});

test("a remote verdict below minConfidence is treated as inline", async () => {
  const { deps, config, store } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku", confidence: 0.4 }, true), heuristics } });
  assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
  assert.equal(store.get("s").model, undefined);
});

test("heuristic verdicts ignore minConfidence", async () => {
  const { deps, config } = setup({ providers: { heuristics: { remote: false, heuristic: true, run: async () => ({ placement: "subagent", model: null, confidence: 0.5 }) } } });
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /subagent/);
});

test("sibling nudge names the native background command", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "sibling", model: "sonnet" }, true), heuristics }, snapshot: priorTurn });
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /claude --bg/);
});

test("cooldown silences the next prompts, then re-evaluates", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku" }, true), heuristics } });
  await handlePrompt({ input, agent: "claude", config, deps });
  for (let i = 0; i < 3; i += 1) assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /subagent/);
});

test("a redaction hit in a personal repo keeps the prompt away from remote providers", async () => {
  let called = false;
  const jev = { remote: true, heuristic: false, run: async () => { called = true; return { placement: "inline", model: "sonnet" }; } };
  const { deps, config } = setup({ providers: { jev, heuristics } });
  await handlePrompt({ input: { ...input, prompt: "email jo@acme.com about it" }, agent: "claude", config, deps });
  assert.equal(called, false);
});

test("work repos use the local chain and never the remote provider", async () => {
  let remoteCalled = false;
  const jev = { remote: true, heuristic: false, run: async () => { remoteCalled = true; return { placement: "inline", model: "opus" }; } };
  const { deps, config } = setup({
    remote: "git@github.com:acme-corp/work-app.git",
    providers: { jev, "qwen-pc": answer({ placement: "subagent", model: "sonnet" }), qwen: down(), heuristics },
  });
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /subagent with model sonnet/);
  assert.equal(remoteCalled, false);
});

test("degraded notice appears once per session and re-arms after a success", async () => {
  const config = merge(DEFAULTS, { chains: { personal: ["jev", "heuristics"] } });
  const providers = { jev: down(true), heuristics };
  const { deps } = setup({ providers, config });
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /degraded/);
  assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
  providers.jev = answer({ placement: "inline", model: "sonnet" }, true);
  assert.deepEqual(await run({ input, agent: "claude", config, deps }), { context: "", notice: "· jev-relay: inline · sonnet" });
  providers.jev = down(true);
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /degraded/);
});

test("disabled agent does nothing", async () => {
  const config = merge(DEFAULTS, { agents: { claude: { enabled: false } } });
  const { deps } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku" }, true), heuristics } });
  assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
  assert.equal(await pickSubagentModel({ input: { tool_input: { prompt: "p" } }, agent: "claude", config, deps }), null);
});

test("codex gets nudges with its sibling command and never a subagent model pick", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "sibling", model: "sonnet" }, true), heuristics }, snapshot: priorTurn });
  assert.match(await handlePrompt({ input, agent: "codex", config, deps }), /codex exec/);
  assert.equal(await pickSubagentModel({ input: { tool_input: { prompt: "p" } }, agent: "codex", config, deps }), null);
});

test("subagent model pick skips explicit models and forks, and classifies on a cache miss", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "inline", model: "opus" }, true), heuristics } });
  const call = (tool_input) => pickSubagentModel({ input: { session_id: "n", cwd: "/x", tool_input }, agent: "claude", config, deps });
  assert.equal(await call({ prompt: "p", model: "haiku" }), null);
  assert.equal(await call({ prompt: "p", subagent_type: "fork" }), null);
  assert.equal(await call({ prompt: "p" }), "opus");
});

test("each nudge carries a short user-facing notice, and the degraded warning has its own", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku" }, true), heuristics } });
  assert.equal((await run({ input, agent: "claude", config, deps })).notice, "↪ jev-relay: subagent · haiku");

  const sibling = setup({ providers: { jev: answer({ placement: "sibling", model: null }, true), heuristics }, snapshot: priorTurn });
  assert.equal((await run({ input, agent: "claude", config: sibling.config, deps: sibling.deps })).notice, "↪ jev-relay: sibling session");

  const down = setup({ providers: { jev: { remote: true, heuristic: false, run: async () => { throw new Error("x"); } }, heuristics } });
  assert.equal((await run({ input, agent: "claude", config: down.config, deps: down.deps })).notice, "⚠ jev-relay: no classifier answered, using heuristics");
});

test("a low-confidence turn drops the cached model so the next pick is fresh", async () => {
  const { deps, config, store } = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku", confidence: 0.4 }, true), heuristics } });
  store.set("s", { model: { value: "opus", at: 1_000_000 } });
  await handlePrompt({ input, agent: "claude", config, deps });
  assert.equal(store.get("s").model, undefined);
});

test("buildNotice has no line for an inline verdict", () => {
  assert.equal(buildNotice({ placement: "inline", model: null, confidence: 0.9 }), null);
});

test("notices show the verdict confidence when the classifier reports one", async () => {
  const sub = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku", confidence: 0.9 }, true), heuristics } });
  assert.equal((await run({ input, agent: "claude", config: sub.config, deps: sub.deps })).notice, "↪ jev-relay: subagent · haiku · 0.90");

  const inline = setup({ providers: { jev: answer({ placement: "inline", model: "sonnet", confidence: 0.75 }, true), heuristics } });
  const out = await run({ input, agent: "claude", config: merge(inline.config, { report: "every-turn" }), deps: inline.deps });
  assert.equal(out.notice, "· jev-relay: inline · sonnet · 0.75");
});

test("every-turn reporting says when a turn was skipped, cooling down, or judged inline", async () => {
  const every = (config) => merge(config, { report: "every-turn" });
  const small = setup({ providers: { jev: answer({ placement: "inline", model: "sonnet" }, true), heuristics }, snapshot: { contextTokens: 12000, lastAt: 1_000_000, turns: [] } });
  const skipped = await run({ input, agent: "claude", config: every(small.config), deps: small.deps });
  assert.deepEqual(skipped, { context: "", notice: "· jev-relay: skipped · 12k tokens, cache warm" });
  assert.equal(await run({ input, agent: "claude", config: small.config, deps: small.deps }), null);

  const big = setup({ providers: { jev: answer({ placement: "inline", model: "sonnet" }, true), heuristics } });
  const inline = await run({ input, agent: "claude", config: every(big.config), deps: big.deps });
  assert.deepEqual(inline, { context: "", notice: "· jev-relay: inline · sonnet" });

  const cooling = setup({ providers: { jev: answer({ placement: "subagent", model: "haiku" }, true), heuristics } });
  await run({ input, agent: "claude", config: every(cooling.config), deps: cooling.deps });
  const next = await run({ input, agent: "claude", config: every(cooling.config), deps: cooling.deps });
  assert.equal(next.notice, "· jev-relay: skipped · cooling down (1/3)");
});

test("default reporting shows an inline line only when the inline model changes", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "inline", model: "haiku", confidence: 0.9 }, true), heuristics } });
  // Arrange
  const first = await run({ input, agent: "claude", config, deps });
  // Act
  const repeat = await run({ input, agent: "claude", config, deps });
  // Assert
  assert.equal(first.notice, "· jev-relay: inline · haiku · 0.90");
  assert.equal(repeat, null);
});

test("a sibling verdict on the first prompt of a session is not offered", async () => {
  const { deps, config } = setup({ providers: { jev: answer({ placement: "sibling", model: "sonnet", confidence: 0.9 }, true), heuristics } });
  assert.equal(await handlePrompt({ input, agent: "claude", config, deps }), null);
});
