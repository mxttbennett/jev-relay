export const AGENT_META = {
  claude: {
    siblingCommand: (model, flags = []) => `claude --bg${model ? ` --model ${model}` : ""}${flags.length ? ` ${flags.join(" ")} --` : ""} "<brief>"`,
    subagentModel: true,
  },
  codex: {
    siblingCommand: (model) => `codex exec${model ? ` -m ${model}` : ""} "<brief>"`,
    subagentModel: false,
  },
};
