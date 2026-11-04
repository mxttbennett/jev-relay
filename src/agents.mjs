import { claudeLine, codexLine, readTranscript } from "./transcripts.mjs";

/**
 * Everything that differs per CLI. Hooks, the classifier and the state store are shared.
 * siblingCommand(model) is what the nudge tells the model to run after the user approves a brief.
 * subagentModel is false where the CLI has no Agent tool to pick a model for.
 */
export const AGENTS = {
  claude: {
    readTranscript: (path) => readTranscript(path, claudeLine),
    siblingCommand: (model) => `claude --bg${model ? ` --model ${model}` : ""} "<brief>"`,
    subagentModel: true,
  },
  codex: {
    readTranscript: (path) => readTranscript(path, codexLine),
    siblingCommand: (model) => `codex exec${model ? ` -m ${model}` : ""} "<brief>"`,
    subagentModel: false,
  },
};

export const agentNames = Object.keys(AGENTS);
