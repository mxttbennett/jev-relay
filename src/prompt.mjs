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

export const JEV_QUESTIONS = {
  placement: {
    type: "choice",
    instructions:
      "Given `query` (recent turns, then the latest user prompt), where should the latest prompt run?",
    criteria: PLACEMENT_CRITERIA,
  },
  model_choice: {
    type: "choice",
    instructions: "Given `query`, which Claude model should handle the latest prompt?",
    criteria: MODEL_CRITERIA,
  },
};

export function classifierPrompt({ text }) {
  const list = (criteria) =>
    Object.entries(criteria)
      .map(([name, why]) => `- ${name}: ${why}`)
      .join("\n");
  return [
    "Classify the latest user prompt in this conversation excerpt.",
    "",
    "placement: where it should run",
    list(PLACEMENT_CRITERIA),
    "",
    "model: which model should handle it",
    list(MODEL_CRITERIA),
    "",
    'Reply with only JSON: {"placement":"...","model":"...","confidence":0.0-1.0}',
    "",
    "Excerpt:",
    text,
  ].join("\n");
}

export function toVerdict({ placement, model, confidence }) {
  if (!PLACEMENTS.includes(placement)) throw new Error(`bad placement: ${placement}`);
  if (!MODELS.includes(model)) throw new Error(`bad model: ${model}`);
  return { placement, model, confidence: typeof confidence === "number" ? confidence : null };
}

export function parseVerdict(text) {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error("no JSON in reply");
  return toVerdict(JSON.parse(match[0]));
}
