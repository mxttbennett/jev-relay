#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { defaultDeps } from "../src/deps.mjs";
import { handlePrompt } from "../src/relay.mjs";

const agent = process.argv[2] ?? "claude";

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const config = loadConfig();
  const advice = await handlePrompt({
    input: JSON.parse(raw),
    agent,
    config,
    deps: defaultDeps(agent, config),
  });
  if (advice) {
    console.log(
      JSON.stringify({
        systemMessage: advice.notice,
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: advice.context },
      }),
    );
  }
} catch {}
process.exit(0);
