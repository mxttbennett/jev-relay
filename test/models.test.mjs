import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, merge } from "../src/config.mjs";
import { classifierPrompt, clampModel, jevQuestions, parseVerdict, toVerdict } from "../src/prompt.mjs";
import { createProviders } from "../src/providers.mjs";
import { classify, handlePrompt } from "../src/relay.mjs";

test("clampModel keeps allowed models, steps up first, then down, and yields null for none", () => {
  assert.equal(clampModel("sonnet", ["haiku", "sonnet"]), "sonnet");
  assert.equal(clampModel("haiku", ["sonnet", "opus"]), "sonnet");
  assert.equal(clampModel("opus", ["haiku", "sonnet"]), "sonnet");
  assert.equal(clampModel("opus", []), null);
});

test("toVerdict clamps a disallowed pick and still rejects a nonsense model", () => {
  assert.equal(toVerdict({ placement: "inline", model: "opus" }, ["haiku", "sonnet"]).model, "sonnet");
  assert.throws(() => toVerdict({ placement: "inline", model: "gpt" }, ["sonnet"]));
  assert.equal(toVerdict({ placement: "inline" }, []).model, null);
  assert.equal(parseVerdict('{"placement":"subagent","model":"opus"}', ["haiku"]).model, "haiku");
});

test("the classifier is only offered the allowed models", () => {
  const prompt = classifierPrompt({ text: "x", models: ["haiku", "sonnet"] });
  assert.match(prompt, /- sonnet:/);
  assert.doesNotMatch(prompt, /- opus:/);
  assert.deepEqual(Object.keys(jevQuestions(["haiku"]).model_choice.criteria), ["haiku"]);
  assert.equal(jevQuestions([]).model_choice, undefined);
  assert.doesNotMatch(classifierPrompt({ text: "x", models: [] }), /"model"/);
});

test("the jev request carries only the allowed models", async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ answers: { placement: { choice: "inline" }, model_choice: { choice: "opus" } } }) };
  };
  const { jev } = createProviders(DEFAULTS, { config: DEFAULTS, env: { OPENROUTER_API_KEY: "k" }, fetch });
  const verdict = await jev.run({ text: "x", models: ["haiku", "sonnet"] });
  assert.deepEqual(Object.keys(body.questions.model_choice.criteria), ["haiku", "sonnet"]);
  assert.equal(verdict.model, "sonnet");
});

test("classify passes each agent its own allowlist, and none when an agent lists none", async () => {
  const seen = [];
  const providers = { heuristics: { remote: false, heuristic: true, run: async (input) => { seen.push(input.models); return { placement: "inline", model: null }; } } };
  const config = merge(DEFAULTS, { models: { claude: ["haiku", "bogus"], codex: [] }, chains: { work: ["heuristics"], personal: ["heuristics"] } });
  const deps = { providers, remoteOf: () => "" };
  await classify({ text: "x", prompt: "x", agent: "claude", cwd: "/x" }, config, deps);
  await classify({ text: "x", prompt: "x", agent: "codex", cwd: "/x" }, config, deps);
  assert.deepEqual(seen, [["haiku"], []]);
});

test("codex has its own allowlist and its sibling command carries the mapped Codex model", async () => {
  const seen = [];
  const jev = { remote: true, heuristic: false, run: async (input) => { seen.push(input.models); return { placement: "sibling", model: "sonnet" }; } };
  const heuristics = { remote: false, heuristic: true, run: async () => ({ placement: "inline", model: null }) };
  const config = merge(DEFAULTS, { models: { claude: ["opus"], codex: ["haiku", "sonnet"] } });
  const deps = {
    env: {}, now: () => 1_000_000, remoteOf: () => "git@github-personal:mxttbennett/x.git",
    readTranscript: () => ({ contextTokens: 150000, lastAt: 1_000_000, turns: [] }),
    providers: { jev, heuristics },
    state: { load: () => ({}), save() {}, log() {} },
  };
  const input = { session_id: "s", prompt: "do the other thing", cwd: "/x", transcript_path: "/t" };
  const out = await handlePrompt({ input, agent: "codex", config, deps });
  assert.deepEqual(seen, [["haiku", "sonnet"]]);
  assert.match(out, /codex exec -m gpt-6\.1-terra "<brief>"/);
});

test("claude sibling command names the tier, and drops the flag when there is no model", async () => {
  const config = merge(DEFAULTS, { models: { claude: [] } });
  const jev = { remote: true, heuristic: false, run: async () => ({ placement: "sibling", model: null }) };
  const deps = {
    env: {}, now: () => 1_000_000, remoteOf: () => "git@github-personal:mxttbennett/x.git",
    readTranscript: () => ({ contextTokens: 150000, lastAt: 1_000_000, turns: [] }),
    providers: { jev },
    state: { load: () => ({}), save() {}, log() {} },
  };
  const input = { session_id: "s", prompt: "p", cwd: "/x", transcript_path: "/t" };
  assert.match(await handlePrompt({ input, agent: "claude", config, deps }), /run: claude --bg "<brief>"/);
});
