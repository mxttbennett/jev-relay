import { AGENT_META } from "./agent-meta.mjs";

export const DEGRADED_NOTICE =
  "jev-relayer: no classifier answered, so routing advice is degraded to heuristics for this session.";

export const DEGRADED_BADGE = "⚠ jev-relayer: no classifier answered, using heuristics";

const detail = (verdict) => {
  const model = verdict.model ? ` · ${verdict.model}` : "";
  const confidence = verdict.confidence == null ? "" : ` · ${verdict.confidence.toFixed(2)}`;
  return `${model}${confidence}`;
};

export function buildNotice(verdict) {
  if (verdict.placement === "subagent") return `↪ jev-relayer: subagent${detail(verdict)}`;
  if (verdict.placement === "sibling") return `↪ jev-relayer: sibling session${detail(verdict)}`;
  return null;
}

export const skipNotice = (why) => `· jev-relayer: skipped · ${why}`;

export const inlineNotice = (verdict) => `· jev-relayer: inline${detail(verdict)}`;

export const modelNotice = (model) => `↪ jev-relayer: subagent model → ${model}`;

export function buildNudge(verdict, { agent, contextTokens, flags = [] }) {
  const size = `${Math.round(contextTokens / 1000)}k tokens`;
  const model = verdict.model ? ` with model ${verdict.model}` : "";
  if (verdict.placement === "subagent") {
    return `jev-relayer: this prompt looks self-contained and read-heavy, and the conversation is large (${size}). Prefer a subagent${model} (Explore for searches) over continuing inline.`;
  }
  if (verdict.placement === "sibling") {
    const command = AGENT_META[agent].siblingCommand(verdict.model, flags);
    return `jev-relayer: this prompt looks independent of the conversation, which is large (${size}). Write a short handoff brief without pasting this conversation, show it to the user, and once they approve run: ${command}`;
  }
  return null;
}
