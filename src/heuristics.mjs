const FAN_OUT =
  /\b(find all|audit|review (the )?(whole|entire|all)|across (the )?(repo|codebase)|every (file|place|usage)|search (the )?(whole|entire)|investigate|survey)\b/i;
const INDEPENDENT =
  /\b(unrelated|separate (task|thing)|different (task|thing)|new task|meanwhile|in the background)\b/i;

export function shouldClassify({ contextTokens, idleMs }, gate) {
  if (contextTokens >= gate.contextTokens) return true;
  return idleMs >= gate.cacheTtlMs && contextTokens >= gate.coldMinTokens;
}

export function heuristicVerdict({ prompt, contextTokens, idleMs }, gate) {
  const costly = shouldClassify({ contextTokens, idleMs }, gate);
  if (costly && INDEPENDENT.test(prompt)) {
    return { placement: "sibling", model: null, confidence: 0.5 };
  }
  if (costly && FAN_OUT.test(prompt)) {
    return { placement: "subagent", model: null, confidence: 0.5 };
  }
  return { placement: "inline", model: null, confidence: 0.5 };
}
