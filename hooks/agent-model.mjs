#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { defaultDeps } from "../src/deps.mjs";
import { pickSubagentModel } from "../src/relay.mjs";

const agent = process.argv[2] ?? "claude";

try {
  if (process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME === "Jev Router") process.exit(0);
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const config = loadConfig();
  const model = await pickSubagentModel({ input, agent, config, deps: defaultDeps(agent, config) });
  if (model) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { ...input.tool_input, model },
        },
      }),
    );
  }
} catch {}
process.exit(0);
