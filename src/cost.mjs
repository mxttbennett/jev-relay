import { tierOf } from "./tiers.mjs";

const PER = 1_000_000;

export function turnCost(usage, model, pricing) {
  const price = pricing[tierOf(model)];
  if (!price) return null;
  return (
    ((usage.inputTokens ?? 0) * price.input +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheCreationTokens ?? 0) * price.cacheWrite +
      (usage.outputTokens ?? 0) * price.output) /
    PER
  );
}

export function costSummary(applied, pricing) {
  let actual = 0;
  let baseline = 0;
  let turns = 0;
  for (const e of applied) {
    const served = turnCost(e, e.served ?? e.sessionModel, pricing);
    const base = turnCost(e, e.sessionModel, pricing);
    if (served == null || base == null) continue;
    actual += served;
    baseline += base;
    turns += 1;
  }
  return { turns, actual, baseline, saved: baseline - actual };
}
