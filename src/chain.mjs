const FALLBACK = { placement: "inline", model: null, effort: null, confidence: null };

export async function runChain(names, providers, input) {
  const failures = [];
  for (const name of names) {
    const provider = providers[name];
    if (!provider) {
      failures.push({ name, error: "unknown provider" });
      continue;
    }
    try {
      const verdict = await provider.run(input);
      const degraded = provider.heuristic && failures.length > 0;
      return { verdict, provider: name, heuristic: provider.heuristic, degraded, failures };
    } catch (err) {
      failures.push({ name, error: err.message });
    }
  }
  return { verdict: FALLBACK, provider: null, heuristic: true, degraded: true, failures };
}
