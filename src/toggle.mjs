import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { agentNames as AGENTS } from "./agents.mjs";
import { CONFIG_PATH, loadConfig, merge } from "./config.mjs";

export function setEnabled(userConfig, agents, enabled) {
  const patch = Object.fromEntries(agents.map((agent) => [agent, { enabled }]));
  return merge(userConfig, { agents: patch });
}

export function resolveAgents(target) {
  if (target === "all" || target === undefined) return AGENTS;
  if (!AGENTS.includes(target)) throw new Error(`unknown agent: ${target} (claude, codex, all)`);
  return [target];
}

export function runCli(argv, path = CONFIG_PATH) {
  const [command, target] = argv;
  if (command === "status" || command === undefined) {
    const { agents } = loadConfig(path);
    return AGENTS.map((a) => `${a}: ${agents[a].enabled === false ? "off" : "on"}`).join("\n");
  }
  if (command !== "on" && command !== "off") throw new Error("usage: jev-relay status|on|off [claude|codex|all]");
  let user = {};
  try {
    user = JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  const next = setEnabled(user, resolveAgents(target), command === "on");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return runCli(["status"], path);
}
