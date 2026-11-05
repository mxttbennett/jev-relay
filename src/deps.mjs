import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENTS } from "./agents.mjs";
import { createBreaker } from "./breaker.mjs";
import { gitRemote } from "./config.mjs";
import { parseEnv } from "./envfile.mjs";
import { createProviders } from "./providers.mjs";
import { STATE_DIR, createStateStore } from "./state.mjs";

const JEV_ENV = join(homedir(), ".config", "jev-opus", ".env");

function readEnvFile(path) {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const BREAKER_FILE = join(STATE_DIR, "breaker.json");

const fileBreaker = () =>
  createBreaker({
    read: () => JSON.parse(readFileSync(BREAKER_FILE, "utf8")),
    write: (entries) => {
      mkdirSync(dirname(BREAKER_FILE), { recursive: true });
      writeFileSync(BREAKER_FILE, JSON.stringify(entries));
    },
  });

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
    breaker: fileBreaker(),
    readTranscript: spec.readTranscript,
    providers: createProviders(config, { config, env, fetch: timedFetch, readJevEnv: () => readEnvFile(JEV_ENV) }),
  };
}
