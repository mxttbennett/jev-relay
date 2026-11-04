export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function relayStatus(config, log, sessionId) {
  const enabled = config?.agents?.claude?.enabled !== false;
  let last;
  for (const line of log.split("\n")) {
    if (!line) continue;
    const entry = parseJson(line);
    if (entry.session === sessionId && entry.event === "prompt" && entry.verdict) last = entry.verdict;
  }
  return { enabled, model: last?.model, confidence: last?.confidence };
}

export function relayLine(status) {
  if (!status.enabled) return "relay: off";
  if (!status.model) return "relay: on";
  return `relay: on · ${status.model} ${Math.round((status.confidence ?? 0) * 100)}%`;
}
