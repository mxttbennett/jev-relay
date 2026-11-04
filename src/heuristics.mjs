const FAN_OUT =
  /\b(find all|audit|review (the )?(whole|entire|all)|across (the )?(repo|codebase)|every (file|place|usage)|search (the )?(whole|entire)|investigate|survey)\b/i;
const INDEPENDENT =
  /\b(unrelated|separate (task|thing)|different (task|thing)|new task|meanwhile|in the background)\b/i;

function matches(patterns, prompt) {
  return patterns.some((source) => {
    try {
      return new RegExp(source, "i").test(prompt);
    } catch {
      return false;
    }
  });
}

export const isHeavy = (prompt, gate) => matches(gate.heavyPatterns, prompt ?? "");

export function shouldClassify({ contextTokens, idleMs, prompt }, gate) {
  if (contextTokens >= gate.contextTokens) return true;
  if (idleMs >= gate.cacheTtlMs && contextTokens >= gate.coldMinTokens) return true;
  return contextTokens >= gate.heavyFloorTokens && isHeavy(prompt, gate);
}

export function heuristicVerdict({ prompt, contextTokens, idleMs }, gate) {
  const open = shouldClassify({ contextTokens, idleMs, prompt }, gate);
  if (open && INDEPENDENT.test(prompt)) {
    return { placement: "sibling", model: null, effort: null, confidence: 0.5 };
  }
  if (open && (FAN_OUT.test(prompt) || isHeavy(prompt, gate))) {
    return { placement: "subagent", model: null, effort: null, confidence: 0.5 };
  }
  return { placement: "inline", model: null, effort: null, confidence: 0.5 };
}
