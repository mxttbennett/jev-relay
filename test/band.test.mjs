import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJson, relayLine, relayStatus } from "../src/band.mjs";

const log = [
  JSON.stringify({ event: "prompt", session: "a", verdict: { model: "haiku", confidence: 0.5 } }),
  JSON.stringify({ event: "prompt", session: "b", verdict: { model: "opus", confidence: 0.9 } }),
  JSON.stringify({ event: "prompt", session: "a", verdict: { model: "sonnet", confidence: 0.94 } }),
  JSON.stringify({ event: "prompt", session: "a" }),
].join("\n");

test("uses the latest verdict for the session", () => {
  // Arrange
  const config = {};

  // Act
  const status = relayStatus(config, log, "a");

  // Assert
  assert.deepEqual(status, { enabled: true, model: "sonnet", confidence: 0.94 });
});

test("reports no verdict for a session with none", () => {
  // Arrange
  const config = {};

  // Act
  const status = relayStatus(config, log, "c");

  // Assert
  assert.deepEqual(status, { enabled: true, model: undefined, confidence: undefined });
});

test("treats a missing claude entry as on and an explicit false as off", () => {
  // Arrange
  const off = { agents: { claude: { enabled: false } } };
  const missing = { agents: {} };

  // Act
  const offStatus = relayStatus(off, "", "a");
  const missingStatus = relayStatus(missing, "", "a");

  // Assert
  assert.equal(offStatus.enabled, false);
  assert.equal(missingStatus.enabled, true);
});

test("formats the band line", () => {
  // Arrange
  const on = { enabled: true, model: "sonnet", confidence: 0.94 };

  // Act
  const line = relayLine(on);

  // Assert
  assert.equal(line, "relay: on · sonnet 94%");
});

test("formats the band line when off or without a verdict", () => {
  // Arrange
  const off = { enabled: false };
  const noVerdict = { enabled: true };

  // Act
  const offLine = relayLine(off);
  const noVerdictLine = relayLine(noVerdict);

  // Assert
  assert.equal(offLine, "relay: off");
  assert.equal(noVerdictLine, "relay: on");
});

test("parseJson returns an empty object on bad input", () => {
  // Arrange
  const bad = "{not json";

  // Act
  const result = parseJson(bad);

  // Assert
  assert.deepEqual(result, {});
});
