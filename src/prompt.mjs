export const PLACEMENTS = ["inline", "subagent", "sibling"];
const PLACEMENT_CRITERIA = {
  inline: "Needs the earlier reasoning or edits in this conversation, or is a small follow-up",
  subagent:
    "Self-contained, read-heavy work (searching or reviewing many files) where only the conclusion matters",
  sibling:
    "Independent of this conversation, long-running, or would bloat it with output nobody needs later",
};

const list = (criteria) =>
  Object.entries(criteria)
    .map(([name, why]) => `- ${name}: ${why}`)
    .join("\n");

const hasModels = (models) => Object.keys(models).length > 0;

export function jevQuestions(models = {}) {
  const questions = {
    placement: {
      type: "choice",
      instructions:
        "Given `query` (recent turns, then the latest user prompt), where should the latest prompt run?",
      criteria: PLACEMENT_CRITERIA,
    },
  };
  if (hasModels(models)) {
    questions.model_choice = {
      type: "choice",
      instructions: "Given `query`, which model should handle the latest prompt?",
      criteria: models,
    };
  }
  return questions;
}

export function classifierPrompt({ text, models = {} }) {
  const modelSection = hasModels(models)
    ? ["model: which model should handle it", list(models), ""]
    : [];
  const reply = hasModels(models)
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

export function toVerdict({ placement, model, confidence }, models = {}) {
  if (!PLACEMENTS.includes(placement)) throw new Error(`bad placement: ${placement}`);
  if (hasModels(models) && !Object.hasOwn(models, model)) throw new Error(`bad model: ${model}`);
  return {
    placement,
    model: hasModels(models) ? model : null,
    confidence: typeof confidence === "number" ? confidence : null,
  };
}

export function parseVerdict(text, models = {}) {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error("no JSON in reply");
  return toVerdict(JSON.parse(match[0]), models);
}
