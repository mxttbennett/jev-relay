import { AGENT_META } from "./agent-meta.mjs";
import { claudeLine, codexLine, readTranscript } from "./transcripts.mjs";

/**
 * Everything that differs per CLI. Hooks, the classifier and the state store are shared.
 * siblingCommand(model) is what the nudge tells the model to run after the user approves a brief.
 * subagentModel is false where the CLI has no Agent tool to pick a model for.
 */
export const AGENTS = {
  claude: { ...AGENT_META.claude, readTranscript: (path) => readTranscript(path, claudeLine) },
  codex: { ...AGENT_META.codex, readTranscript: (path) => readTranscript(path, codexLine) },
};

export const agentNames = Object.keys(AGENTS);
