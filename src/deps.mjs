import { AGENTS } from "./agents.mjs";
import { createProviders } from "./providers.mjs";
import { createStateStore } from "./state.mjs";

export function defaultDeps(agent, config) {
  const spec = AGENTS[agent];
  if (!spec) throw new Error(`unsupported agent: ${agent}`);
  const env = process.env;
  return {
    env,
    now: Date.now,
    state: createStateStore(),
    readTranscript: spec.readTranscript,
    providers: createProviders(config, { config, env, fetch }),
  };
}
