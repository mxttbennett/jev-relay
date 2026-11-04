#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { defaultDeps } from "../src/deps.mjs";
import { execFile } from "node:child_process";
import { notifyCommand } from "../src/notify.mjs";
import { sessionTitle } from "../src/transcripts.mjs";
import { handlePrompt } from "../src/relay.mjs";

const agent = process.argv[2] ?? "claude";

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const config = loadConfig();
  const input = JSON.parse(raw);
  const advice = await handlePrompt({
    input,
    agent,
    config,
    deps: defaultDeps(agent, config),
  });
  if (advice) {
    if (config.macNotifications && advice.notice) {
      const title = sessionTitle(input.transcript_path) || "jev-relay";
      const [cmd, ...args] = notifyCommand(advice.notice, title);
      execFile(cmd, args, { timeout: 3000 }, () => {});
    }
    const output = { systemMessage: advice.notice };
    if (advice.context) {
      output.hookSpecificOutput = {
        hookEventName: "UserPromptSubmit",
        additionalContext: advice.context,
      };
    }
    console.log(JSON.stringify(output));
  }
} catch {}
process.exit(0);
