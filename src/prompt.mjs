export const PLACEMENTS = ["inline", "subagent", "sibling"];
export const MODELS = ["haiku", "sonnet", "opus"];

const PLACEMENT_CRITERIA = {
  inline: "Needs the earlier reasoning or edits in this conversation, or is a small follow-up",
  subagent:
    "Self-contained, read-heavy work (searching or reviewing many files) where only the conclusion matters",
  sibling:
    "Independent of this conversation, long-running, or would bloat it with output nobody needs later",
};

const MODEL_CRITERIA = {
  haiku: "Quick lookups, formatting, boilerplate, low-stakes small edits",
  sonnet: "Default day-to-day coding, feature work, most agentic building",
  opus: "Architecture decisions, hard debugging, security-sensitive work, large multi-file refactors, complex planning",
};

const criteriaFor = (allowed) =>
  Object.fromEntries(Object.entries(MODEL_CRITERIA).filter(([name]) => allowed.includes(name)));

const list = (criteria) =>
  Object.entries(criteria)
    .map(([name, why]) => `- ${name}: ${why}`)
    .join("\n");

export function jevQuestions(allowed = MODELS) {
  const questions = {
    placement: {
      type: "choice",
      instructions:
        "Given `query` (recent turns, then the latest user prompt), where should the latest prompt run?",
      criteria: PLACEMENT_CRITERIA,
    },
  };
  if (allowed.length) {
    questions.model_choice = {
      type: "choice",
      instructions: "Given `query`, which Claude model should handle the latest prompt?",
      criteria: criteriaFor(allowed),
    };
  }
  return questions;
}

export function classifierPrompt({ text, models = MODELS }) {
  const modelSection = models.length
    ? ["model: which model should handle it", list(criteriaFor(models)), ""]
    : [];
  const reply = models.length
    ? '{"placement":"...","model":"...","confidence":0.0-1.0}'
    : '{"placement":"...","confidence":0.0-1.0}';
  return [
    "Classify the latest user prompt in this conversation excerpt.",
    "",
    "placement: where it should run",
    list(PLACEMENT_CRITERIA),
    "",
    ...modelSection,
    `Reply with only JSON: ${reply}`,
    "",
    "Excerpt:",
    text,
  ].join("\n");
}

/** Nearest allowed model, stepping up before down so a hard task never lands on a weaker one. */
export function clampModel(model, allowed) {
  if (!allowed.length) return null;
  if (allowed.includes(model)) return model;
  const rank = MODELS.indexOf(model);
  const up = MODELS.filter((m, i) => i > rank && allowed.includes(m));
  if (up.length) return up[0];
  return MODELS.filter((m, i) => i < rank && allowed.includes(m)).at(-1) ?? null;
}

export function toVerdict({ placement, model, confidence }, allowed = MODELS) {
  if (!PLACEMENTS.includes(placement)) throw new Error(`bad placement: ${placement}`);
  if (allowed.length && !MODELS.includes(model)) throw new Error(`bad model: ${model}`);
  return {
    placement,
    model: clampModel(model, allowed),
    confidence: typeof confidence === "number" ? confidence : null,
  };
}

export function parseVerdict(text, allowed = MODELS) {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error("no JSON in reply");
  return toVerdict(JSON.parse(match[0]), allowed);
}
