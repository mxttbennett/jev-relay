const FAST = "Quick lookups, formatting, boilerplate, low-stakes small edits";
const BALANCED = "Default day-to-day coding, feature work, most agentic building";
const STRONG =
  "Architecture decisions, hard debugging, security-sensitive work, large multi-file refactors, complex planning";

const CLAUDE_MODELS = { haiku: FAST, sonnet: BALANCED, opus: STRONG };
const CODEX_MODELS = { "gpt-6-luna": FAST, "gpt-6.1-terra": BALANCED, "gpt-6.1-sol": STRONG };

const KNOWN_MODELS = { ...CLAUDE_MODELS, ...CODEX_MODELS };

export function describeModels(models) {
  const entries = Array.isArray(models) ? models.map((name) => [name, ""]) : Object.entries(models);
  return Object.fromEntries(entries.map(([name, why]) => [name, why || KNOWN_MODELS[name] || ""]));
}

export const DEFAULTS = {
  agents: { claude: { enabled: true }, codex: { enabled: true } },
  gate: {
    contextTokens: 100000,
    cacheTtlMs: 300000,
    coldMinTokens: 20000,
    heavyFloorTokens: 40000,
    heavyPatterns: [
      "(^|\\s)/(peer-review-pr|deep-plan|quick-wins|untested|code-review|security-review|parallel|babysit-pr|update-cogniform-sdk|archive-transcripts)\\b",
      "\\b(audit|review) (the )?(whole|entire|all)\\b",
      "\\bacross (the )?(repo|codebase)\\b",
      "\\bfind all\\b",
      "\\bevery (file|usage|place)\\b",
    ],
  },
  cooldown: { prompts: 3, growth: 0.25 },
  minConfidence: 0.6,
  band: { enabled: false },
  statusNotice: true,
  report: "changes",
  personalRemotePatterns: ["mxttbennett", "github-personal"],
  models: { claude: CLAUDE_MODELS, codex: CODEX_MODELS },
  efforts: {
    low: "Mechanical or lookup work that needs little reasoning",
    medium: "Typical coding, explanation and review",
    high: "Hard debugging, design and multi-step reasoning",
    xhigh: "The hardest work where extra reasoning pays off",
  },
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

export function resolveConfig(user = {}) {
  const config = merge(DEFAULTS, user);
  if (!(config.minConfidence >= 0 && config.minConfidence <= 1)) config.minConfidence = DEFAULTS.minConfidence;
  const written = Object.entries(user.models ?? {}).map(([agent, models]) => [agent, describeModels(models)]);
  config.models = { ...DEFAULTS.models, ...Object.fromEntries(written) };
  if (user.efforts) config.efforts = user.efforts;
  return config;
}

export function isEnabled(config, agent, env = {}) {
  if (env.JEV_RELAY === "off") return false;
  return config.agents[agent]?.enabled !== false;
}

export function repoClass(config, cwd, remoteOf) {
  const remote = cwd ? remoteOf(cwd) : "";
  return config.personalRemotePatterns.some((p) => remote.includes(p)) ? "personal" : "work";
}
