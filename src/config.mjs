import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".config", "jev-relay", "config.json");

export const DEFAULTS = {
  agents: { claude: { enabled: true }, codex: { enabled: true } },
  gate: { contextTokens: 100000, cacheTtlMs: 300000, coldMinTokens: 20000 },
  cooldown: { prompts: 3, growth: 0.25 },
  personalRemotePatterns: ["mxttbennett", "github-personal"],
  models: { claude: ["haiku", "sonnet", "opus"] },
  redact: { names: [] },
  chains: {
    work: ["qwen-pc", "qwen", "heuristics"],
    personal: ["jev", "heuristics"],
  },
  providers: {
    jev: { type: "jev", timeoutMs: 5000 },
    "qwen-pc": {
      type: "ollama",
      baseUrl: "http://127.0.0.1:11435",
      model: "bonsai-2:27b",
      timeoutMs: 6000,
    },
    qwen: {
      type: "openai-compat",
      baseUrl: "http://localhost:1234/v1",
      modelMatch: "qwen",
      timeoutMs: 6000,
    },
    heuristics: { type: "heuristics" },
  },
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value);
  return out;
}

export function loadConfig(path = CONFIG_PATH) {
  let user = {};
  try {
    user = JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  return merge(DEFAULTS, user);
}

export function isEnabled(config, agent, env = process.env) {
  if (env.JEV_RELAY === "off") return false;
  return config.agents[agent]?.enabled !== false;
}

function gitRemote(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

export function repoClass(config, cwd, remoteOf = gitRemote) {
  const remote = cwd ? remoteOf(cwd) : "";
  return config.personalRemotePatterns.some((p) => remote.includes(p)) ? "personal" : "work";
}
