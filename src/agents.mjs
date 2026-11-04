import { claudeLine, codexLine, readTranscript } from "./transcripts.mjs";

/**
 * Everything that differs per CLI. Hooks, the classifier and the state store are shared.
 * siblingCommand is what the nudge tells the model to run after the user approves a brief.
 * subagentModel is false where the CLI has no Agent tool to pick a model for.
 */
export const AGENTS = {
  claude: {
    readTranscript: (path) => readTranscript(path, claudeLine),
    siblingCommand: 'claude --bg --model <model> "<brief>"',
    subagentModel: true,
  },
  codex: {
    readTranscript: (path) => readTranscript(path, codexLine),
    siblingCommand: 'codex exec "<brief>"',
    subagentModel: false,
  },
};

export const agentNames = Object.keys(AGENTS);
