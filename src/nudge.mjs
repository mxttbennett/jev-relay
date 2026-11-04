import { AGENTS } from "./agents.mjs";

export const DEGRADED_NOTICE =
  "jev-relay: no classifier answered, so routing advice is degraded to heuristics for this session.";

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
