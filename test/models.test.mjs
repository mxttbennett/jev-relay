import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, merge } from "../src/config.mjs";
import { classifierPrompt, clampModel, jevQuestions, parseVerdict, toVerdict } from "../src/prompt.mjs";
import { createProviders } from "../src/providers.mjs";
import { classify } from "../src/relay.mjs";

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

test("classify passes the per-agent allowlist, and none for an agent without model picks", async () => {
  const seen = [];
  const providers = { heuristics: { remote: false, heuristic: true, run: async (input) => { seen.push(input.models); return { placement: "inline", model: null }; } } };
  const config = merge(DEFAULTS, { models: { claude: ["haiku", "bogus"] }, chains: { work: ["heuristics"], personal: ["heuristics"] } });
  const deps = { providers, remoteOf: () => "" };
  await classify({ text: "x", prompt: "x", agent: "claude", cwd: "/x" }, config, deps);
  await classify({ text: "x", prompt: "x", agent: "codex", cwd: "/x" }, config, deps);
  assert.deepEqual(seen, [["haiku"], []]);
});
