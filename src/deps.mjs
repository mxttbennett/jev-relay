import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENTS } from "./agents.mjs";
import { gitRemote } from "./config.mjs";
import { parseEnv } from "./envfile.mjs";
import { createProviders } from "./providers.mjs";
import { createStateStore } from "./state.mjs";

const JEV_ENV = join(homedir(), ".config", "jev-opus", ".env");

function readEnvFile(path) {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const timedFetch = (url, { timeoutMs, ...init }) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

export function defaultDeps(agent, config) {
  const spec = AGENTS[agent];
  if (!spec) throw new Error(`unsupported agent: ${agent}`);
  const env = process.env;
  return {
    env,
    now: Date.now,
    remoteOf: gitRemote,
    state: createStateStore(),
    readTranscript: spec.readTranscript,
    providers: createProviders(config, { config, env, fetch: timedFetch, readJevEnv: () => readEnvFile(JEV_ENV) }),
  };
}
