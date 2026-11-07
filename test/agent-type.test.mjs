import test from "node:test";
import assert from "node:assert/strict";
import { classifierPrompt, jevQuestions, toVerdict } from "../src/prompt.mjs";

test("toVerdict keeps a known agent type and drops an unknown or missing one", () => {
  assert.equal(toVerdict({ placement: "subagent", agent: "Explore" }).agent, "Explore");
  assert.equal("agent" in toVerdict({ placement: "subagent", agent: "dotnet-core-expert" }), false);
  assert.equal("agent" in toVerdict({ placement: "subagent" }), false);
});

test("classifierPrompt and jevQuestions offer the agent types", () => {
  assert.match(classifierPrompt({ text: "x" }), /"agent":"\.\.\."/);
  assert.deepEqual(Object.keys(jevQuestions().agent_choice.criteria), ["general-purpose", "Explore", "Plan"]);
});
