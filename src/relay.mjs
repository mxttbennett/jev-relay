import { AGENTS } from "./agents.mjs";
import { runChain } from "./chain.mjs";
import { isEnabled, repoClass } from "./config.mjs";
import { shouldClassify } from "./heuristics.mjs";
import {
  DEGRADED_BADGE,
  DEGRADED_NOTICE,
  buildNotice,
  buildNudge,
  inlineNotice,
  skipNotice,
} from "./nudge.mjs";
import { redact } from "./redact.mjs";

const TURN_CHARS = 1500;
const TEXT_CHARS = 6000;
const MODEL_TTL_MS = 10 * 60 * 1000;

export async function classify(signals, config, deps) {
  const cls = repoClass(config, signals.cwd, deps.remoteOf);
  const { text, hits } = redact(signals.text, config.redact.names);
  const models = config.models[signals.agent] ?? {};
  const names = config.chains[cls].filter(
    (name) => !(cls === "personal" && hits > 0 && deps.providers[name]?.remote),
  );
  const result = await runChain(names, deps.providers, { ...signals, models, text: text.slice(-TEXT_CHARS) });
  if (!result.heuristic && result.verdict.confidence != null && result.verdict.confidence < config.minConfidence) {
    result.verdict = { placement: "inline", model: null, confidence: result.verdict.confidence };
  }
  return { result, cls, hits };
}

function coolingDown(nudge, contextTokens, cooldown) {
  return (
    Boolean(nudge) &&
    nudge.promptsSince < cooldown.prompts &&
    contextTokens < nudge.tokens * (1 + cooldown.growth)
  );
}

function excerptOf(turns, prompt) {
  const earlier = turns.at(-1)?.role === "user" && turns.at(-1).text === prompt ? turns.slice(0, -1) : turns;
  const lines = earlier.map((t) => `${t.role}: ${t.text.slice(0, TURN_CHARS)}`);
  return [...lines, `user: ${prompt.slice(0, TURN_CHARS)}`].join("\n\n");
}

export async function handlePrompt({ input, agent, config, deps }) {
  if (!isEnabled(config, agent, deps.env)) return null;
  const snapshot = deps.readTranscript(input.transcript_path);
  const contextTokens = snapshot.contextTokens;
  const idleMs = snapshot.lastAt ? deps.now() - snapshot.lastAt : 0;
  const everyTurn = config.report === "every-turn";
  if (!shouldClassify({ contextTokens, idleMs, prompt: input.prompt }, config.gate)) {
    const cache = idleMs >= config.gate.cacheTtlMs ? "cold" : "warm";
    const why = `${Math.round(contextTokens / 1000)}k tokens, cache ${cache}`;
    return everyTurn ? { context: "", notice: skipNotice(why) } : null;
  }

  const state = deps.state.load(input.session_id);
  if (coolingDown(state.nudge, contextTokens, config.cooldown)) {
    state.nudge.promptsSince += 1;
    deps.state.save(input.session_id, state);
    const why = `cooling down (${state.nudge.promptsSince}/${config.cooldown.prompts})`;
    return everyTurn ? { context: "", notice: skipNotice(why) } : null;
  }

  const { result, cls, hits } = await classify(
    {
      text: excerptOf(snapshot.turns, input.prompt),
      prompt: input.prompt,
      agent,
      contextTokens,
      idleMs,
      cwd: input.cwd,
    },
    config,
    deps,
  );
  deps.state.log({
    event: "prompt",
    agent,
    session: input.session_id,
    repoClass: cls,
    redactionHits: hits,
    contextTokens,
    idleMs,
    provider: result.provider,
    verdict: result.verdict,
    failures: result.failures,
  });

  const lines = [];
  const notices = [];
  if (result.degraded && !state.degradedWarned) {
    lines.push(DEGRADED_NOTICE);
    notices.push(DEGRADED_BADGE);
    state.degradedWarned = true;
  } else if (!result.heuristic) {
    state.degradedWarned = false;
  }
  if (!result.heuristic && result.verdict.model) {
    state.model = { value: result.verdict.model, at: deps.now() };
  }
  const nudge = buildNudge(result.verdict, { agent, contextTokens });
  if (nudge) {
    lines.push(nudge);
    notices.push(buildNotice(result.verdict));
    state.nudge = { promptsSince: 0, tokens: contextTokens };
  } else {
    delete state.nudge;
  }
  deps.state.save(input.session_id, state);
  if (lines.length) return { context: lines.join("\n"), notice: notices.join("\n") };
  return everyTurn ? { context: "", notice: inlineNotice(result.verdict) } : null;
}

export async function pickSubagentModel({ input, agent, config, deps }) {
  if (!isEnabled(config, agent, deps.env) || !AGENTS[agent].subagentModel) return null;
  const tool = input.tool_input ?? {};
  if (tool.model || tool.subagent_type === "fork" || !tool.prompt) return null;

  const state = deps.state.load(input.session_id);
  if (state.model && deps.now() - state.model.at < MODEL_TTL_MS) return state.model.value;

  const { result, cls, hits } = await classify(
    { text: `user: ${tool.prompt.slice(0, TURN_CHARS)}`, prompt: tool.prompt, agent, contextTokens: 0, idleMs: 0, cwd: input.cwd },
    config,
    deps,
  );
  deps.state.log({
    event: "agent",
    agent,
    session: input.session_id,
    repoClass: cls,
    redactionHits: hits,
    provider: result.provider,
    model: result.verdict.model,
    failures: result.failures,
  });
  return result.heuristic ? null : result.verdict.model;
}
