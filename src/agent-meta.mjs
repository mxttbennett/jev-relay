export const AGENT_META = {
  claude: {
    siblingCommand: (model) => `claude --bg${model ? ` --model ${model}` : ""} "<brief>"`,
    subagentModel: true,
  },
  codex: {
    siblingCommand: (model) => `codex exec${model ? ` -m ${model}` : ""} "<brief>"`,
    subagentModel: false,
  },
};
