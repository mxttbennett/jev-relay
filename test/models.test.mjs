import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig, merge } from "../src/config.mjs";
import { classifierPrompt, jevQuestions, parseVerdict, toVerdict } from "../src/prompt.mjs";
import { createProviders } from "../src/providers.mjs";
import { classify, handlePrompt } from "../src/relay.mjs";

const two = { haiku: "fast things", sonnet: "everyday things" };

test("a model outside the offered list is rejected, so the chain moves on", () => {
  assert.equal(toVerdict({ placement: "inline", model: "sonnet" }, two).model, "sonnet");
  assert.throws(() => toVerdict({ placement: "inline", model: "opus" }, two), /bad model/);
  assert.throws(() => parseVerdict('{"placement":"inline","model":"gpt"}', two));
  assert.equal(toVerdict({ placement: "inline" }, {}).model, null);
});

test("the classifier is only offered the listed models, with their descriptions", () => {
  const prompt = classifierPrompt({ text: "x", models: two });
  assert.match(prompt, /- sonnet: everyday things/);
  assert.doesNotMatch(prompt, /opus/);
  assert.deepEqual(jevQuestions(two).model_choice.criteria, two);
  assert.equal(jevQuestions({}).model_choice, undefined);
  assert.doesNotMatch(classifierPrompt({ text: "x", models: {} }), /"model"/);
});

test("the jev request carries only the listed models", async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ answers: { placement: { choice: "inline" }, model_choice: { choice: "sonnet" } } }) };
  };
  const { jev } = createProviders(DEFAULTS, { config: DEFAULTS, env: { OPENROUTER_API_KEY: "k" }, fetch });
  const verdict = await jev.run({ text: "x", models: two });
  assert.deepEqual(Object.keys(body.questions.model_choice.criteria), ["haiku", "sonnet"]);
  assert.equal(verdict.model, "sonnet");
});

test("defaults give claude tier names and codex its own model names", () => {
  assert.deepEqual(Object.keys(DEFAULTS.models.claude), ["haiku", "sonnet", "opus"]);
  assert.deepEqual(Object.keys(DEFAULTS.models.codex), ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"]);
});

test("a user models list replaces the default list for that agent only", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ models: { claude: { sonnet: "only this" } } }));
  const config = loadConfig(path);
  assert.deepEqual(config.models.claude, { sonnet: "only this" });
  assert.deepEqual(Object.keys(config.models.codex), Object.keys(DEFAULTS.models.codex));
});

test("classify passes each agent its own models, and none when an agent lists none", async () => {
  const seen = [];
  const providers = { heuristics: { remote: false, heuristic: true, run: async (input) => { seen.push(Object.keys(input.models)); return { placement: "inline", model: null }; } } };
  const config = merge(DEFAULTS, { chains: { work: ["heuristics"], personal: ["heuristics"] } });
  config.models = { claude: two, codex: {} };
  const deps = { providers, remoteOf: () => "" };
  await classify({ text: "x", prompt: "x", agent: "claude", cwd: "/x" }, config, deps);
  await classify({ text: "x", prompt: "x", agent: "codex", cwd: "/x" }, config, deps);
  assert.deepEqual(seen, [["haiku", "sonnet"], []]);
});

function relayDeps(provider) {
  return {
    env: {}, now: () => 1_000_000, remoteOf: () => "git@github-personal:mxttbennett/x.git",
    readTranscript: () => ({ contextTokens: 150000, lastAt: 1_000_000, turns: [] }),
    providers: { jev: provider },
    state: { load: () => ({}), save() {}, log() {} },
  };
}
const input = { session_id: "s", prompt: "do the other thing", cwd: "/x", transcript_path: "/t" };

test("codex sibling command carries the Codex model name the classifier chose", async () => {
  const jev = { remote: true, heuristic: false, run: async () => ({ placement: "sibling", model: "gpt-6.1-terra" }) };
  const out = await handlePrompt({ input, agent: "codex", config: DEFAULTS, deps: relayDeps(jev) });
  assert.match(out, /codex exec -m gpt-6\.1-terra "<brief>"/);
});

test("claude sibling command names the model, and drops the flag when there is none", async () => {
  const named = { remote: true, heuristic: false, run: async () => ({ placement: "sibling", model: "sonnet" }) };
  assert.match(await handlePrompt({ input, agent: "claude", config: DEFAULTS, deps: relayDeps(named) }), /claude --bg --model sonnet "<brief>"/);
  const none = { remote: true, heuristic: false, run: async () => ({ placement: "sibling", model: null }) };
  assert.match(await handlePrompt({ input, agent: "claude", config: DEFAULTS, deps: relayDeps(none) }), /run: claude --bg "<brief>"/);
});
