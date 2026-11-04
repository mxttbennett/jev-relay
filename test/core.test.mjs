import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runChain } from "../src/chain.mjs";
import { DEFAULTS, isEnabled, loadConfig, merge, repoClass } from "../src/config.mjs";
import { heuristicVerdict, shouldClassify } from "../src/heuristics.mjs";
import { parseVerdict } from "../src/prompt.mjs";
import { createProviders } from "../src/providers.mjs";
import { redact } from "../src/redact.mjs";
import { readTranscript, claudeLine, codexLine } from "../src/transcripts.mjs";
import { resolveAgents, runCli, setEnabled } from "../src/toggle.mjs";

const gate = DEFAULTS.gate;

test("redact masks strong identifiers and counts them", () => {
  const { text, hits } = redact("mail jo@acme.com ssn 123-45-6789 call 555-123-4567 re Acme", ["Acme"]);
  assert.equal(hits, 4);
  assert.ok(!/acme|123-45|555/i.test(text));
});

test("redact masks weak patterns without counting a hit", () => {
  const { text, hits } = redact("on 3/4/2026 order 1234567\n```\ncode\n```");
  assert.equal(hits, 0);
  assert.equal(text.includes("[date]") && text.includes("[id]") && text.includes("[code block]"), true);
});

test("gate opens on size, or on a cold cache with a non-trivial context", () => {
  assert.equal(shouldClassify({ contextTokens: 150000, idleMs: 0 }, gate), true);
  assert.equal(shouldClassify({ contextTokens: 30000, idleMs: 400000 }, gate), true);
  assert.equal(shouldClassify({ contextTokens: 5000, idleMs: 400000 }, gate), false);
  assert.equal(shouldClassify({ contextTokens: 30000, idleMs: 1000 }, gate), false);
});

test("heuristics nudge only on a clear signal", () => {
  const big = { contextTokens: 150000, idleMs: 0 };
  assert.equal(heuristicVerdict({ prompt: "audit every file for X", ...big }, gate).placement, "subagent");
  assert.equal(heuristicVerdict({ prompt: "new task: unrelated cleanup", ...big }, gate).placement, "sibling");
  assert.equal(heuristicVerdict({ prompt: "fix that typo", ...big }, gate).placement, "inline");
  assert.equal(heuristicVerdict({ prompt: "audit every file", contextTokens: 1000, idleMs: 0 }, gate).placement, "inline");
});

test("parseVerdict reads JSON inside prose and rejects bad enums", () => {
  assert.deepEqual(parseVerdict('ok {"placement":"subagent","model":"haiku","confidence":0.8}'), {
    placement: "subagent",
    model: "haiku",
    confidence: 0.8,
  });
  assert.throws(() => parseVerdict('{"placement":"elsewhere","model":"haiku"}'));
  assert.throws(() => parseVerdict("no json"));
});

test("chain falls through failures and flags degraded only when heuristics answers after a failure", async () => {
  const ok = { heuristic: false, run: async () => ({ placement: "inline", model: "sonnet", confidence: 1 }) };
  const bad = { heuristic: false, run: async () => { throw new Error("down"); } };
  const heur = { heuristic: true, run: async () => ({ placement: "inline", model: null, confidence: 0.5 }) };

  const first = await runChain(["bad", "ok", "heur"], { bad, ok, heur }, {});
  assert.equal(first.provider, "ok");
  assert.equal(first.degraded, false);
  assert.equal(first.failures.length, 1);

  const allDown = await runChain(["bad", "heur"], { bad, heur }, {});
  assert.equal(allDown.provider, "heur");
  assert.equal(allDown.degraded, true);

  const onlyHeuristics = await runChain(["heur"], { heur }, {});
  assert.equal(onlyHeuristics.degraded, false);

  const none = await runChain(["bad"], { bad }, {});
  assert.equal(none.degraded, true);
  assert.equal(none.verdict.placement, "inline");
});

test("config merges user overrides, replaces arrays, and classifies repos", () => {
  const merged = merge(DEFAULTS, { chains: { work: ["heuristics"] }, agents: { codex: { enabled: false } } });
  assert.deepEqual(merged.chains.work, ["heuristics"]);
  assert.deepEqual(merged.chains.personal, DEFAULTS.chains.personal);
  assert.equal(isEnabled(merged, "codex", {}), false);
  assert.equal(isEnabled(merged, "claude", {}), true);
  assert.equal(isEnabled(merged, "claude", { JEV_RELAY: "off" }), false);
  assert.equal(repoClass(DEFAULTS, "/x", () => "git@github-personal:mxttbennett/dots.git"), "personal");
  assert.equal(repoClass(DEFAULTS, "/x", () => "git@github.com:acme-corp/work-app.git"), "work");
  assert.equal(repoClass(DEFAULTS, "/x", () => ""), "work");
});

test("jev provider tries OpenRouter then TypeSafe and accepts JEV_API_KEY", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("openrouter")) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ answers: { placement: { choice: "sibling", confidence: 0.9 }, model_choice: { choice: "opus" } } }) };
  };
  const env = { OPENROUTER_API_KEY: "a", JEV_API_KEY: "b" };
  const { jev } = createProviders(DEFAULTS, { config: DEFAULTS, env, fetch });
  assert.deepEqual(await jev.run({ text: "x" }), { placement: "sibling", model: "opus", confidence: 0.9 });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("typesafe"));
});

test("ollama provider sends think:true and reads message.content", async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: '{"placement":"inline","model":"sonnet"}' } }) };
  };
  const providers = createProviders(DEFAULTS, { config: DEFAULTS, env: {}, fetch });
  const verdict = await providers["qwen-pc"].run({ text: "user: hi" });
  assert.equal(body.think, true);
  assert.equal(body.model, "bonsai-2:27b");
  assert.equal(verdict.model, "sonnet");
});

test("claude transcript yields context size, last assistant time and recent prose turns", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const file = join(dir, "t.jsonl");
  const rows = [
    { type: "user", message: { role: "user", content: "first question" }, timestamp: "2026-01-01T00:00:00Z" },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "answer" }, { type: "tool_use" }], usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5 } }, timestamp: "2026-01-01T00:00:05Z" },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "SECRET ROWS" }] }, timestamp: "2026-01-01T00:00:06Z" },
    { type: "assistant", isSidechain: true, message: { role: "assistant", content: "ignored" } },
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n"));
  const snap = readTranscript(file, claudeLine);
  assert.equal(snap.contextTokens, 105);
  assert.equal(snap.lastAt, Date.parse("2026-01-01T00:00:05Z"));
  assert.deepEqual(snap.turns.map((t) => t.text), ["first question", "answer"]);
  assert.deepEqual(readTranscript(join(dir, "missing.jsonl"), claudeLine).turns, []);
});

test("codex transcript yields last input tokens, timestamp and prose turns, skipping injected context", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const file = join(dir, "rollout.jsonl");
  const rows = [
    { timestamp: "2026-01-01T00:00:00Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /x" }] } },
    { timestamp: "2026-01-01T00:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "refactor the parser" }] } },
    { timestamp: "2026-01-01T00:00:02Z", type: "response_item", payload: { type: "reasoning", summary: [] } },
    { timestamp: "2026-01-01T00:00:03Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 22906 } } } },
    { timestamp: "2026-01-01T00:00:04Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } },
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n"));
  const snap = readTranscript(file, codexLine);
  assert.equal(snap.contextTokens, 22906);
  assert.equal(snap.lastAt, Date.parse("2026-01-01T00:00:03Z"));
  assert.deepEqual(snap.turns, [
    { role: "user", text: "refactor the parser" },
    { role: "assistant", text: "done" },
  ]);
});

test("toggle writes per-agent flags and reports status", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const path = join(dir, "config.json");
  assert.equal(runCli(["status"], path), "claude: on\ncodex: on");
  assert.equal(runCli(["off", "codex"], path), "claude: on\ncodex: off");
  assert.equal(runCli(["on", "all"], path), "claude: on\ncodex: on");
  assert.deepEqual(setEnabled({}, ["claude"], false), { agents: { claude: { enabled: false } } });
  assert.throws(() => resolveAgents("gemini"));
  assert.equal(loadConfig(path).agents.codex.enabled, true);
});
