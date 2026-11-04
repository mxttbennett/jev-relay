const FALLBACK = { placement: "inline", model: null, effort: null, confidence: null };

export async function runChain(names, providers, input) {
  const failures = [];
  const started = performance.now();
  const elapsed = (since) => Math.round(performance.now() - since);
  for (const name of names) {
    const provider = providers[name];
    if (!provider) {
      failures.push({ name, error: "unknown provider", ms: 0 });
      continue;
    }
    const attempt = performance.now();
    try {
      const verdict = await provider.run(input);
      const degraded = provider.heuristic && failures.length > 0;
      return {
        verdict,
        provider: name,
        heuristic: provider.heuristic,
        degraded,
        failures,
        providerMs: elapsed(attempt),
        latencyMs: elapsed(started),
      };
    } catch (err) {
      failures.push({ name, error: err.message, ms: elapsed(attempt) });
    }
  }
  return {
    verdict: FALLBACK,
    provider: null,
    heuristic: true,
    degraded: true,
    failures,
    providerMs: 0,
    latencyMs: elapsed(started),
  };
}
