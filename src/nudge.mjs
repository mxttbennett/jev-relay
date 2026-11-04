import { AGENTS } from "./agents.mjs";

export const DEGRADED_NOTICE =
  "jev-relay: no classifier answered, so routing advice is degraded to heuristics for this session.";

export const DEGRADED_BADGE = "⚠ jev-relay: no classifier answered, using heuristics";

export function buildNotice(verdict) {
  const model = verdict.model ? ` · ${verdict.model}` : "";
  if (verdict.placement === "subagent") return `↪ jev-relay: subagent${model}`;
  if (verdict.placement === "sibling") return `↪ jev-relay: sibling session${model}`;
  return null;
}

export const skipNotice = (why) => `· jev-relay: skipped · ${why}`;

export const inlineNotice = (verdict) =>
  `· jev-relay: inline${verdict.model ? ` · ${verdict.model}` : ""}`;

export const modelNotice = (model) => `↪ jev-relay: subagent model → ${model}`;

export function buildNudge(verdict, { agent, contextTokens }) {
  const size = `${Math.round(contextTokens / 1000)}k tokens`;
  const model = verdict.model ? ` with model ${verdict.model}` : "";
  if (verdict.placement === "subagent") {
    return `jev-relay: this prompt looks self-contained and read-heavy, and the conversation is large (${size}). Prefer a subagent${model} (Explore for searches) over continuing inline.`;
  }
  if (verdict.placement === "sibling") {
    const command = AGENTS[agent].siblingCommand(verdict.model);
    return `jev-relay: this prompt looks independent of the conversation, which is large (${size}). Write a short handoff brief without pasting this conversation, show it to the user, and once they approve run: ${command}`;
  }
  return null;
}
