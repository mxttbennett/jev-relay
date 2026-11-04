export const notifyCommand = (message, title = "jev-relay") => [
  "osascript",
  "-e", "on run argv",
  "-e", "display notification (item 1 of argv) with title (item 2 of argv)",
  "-e", "end run",
  message,
  title,
];

export const decisionLabel = ({ placement, model, effort, confidence }) =>
  [placement, [model, effort].filter(Boolean).join(" · "), confidence == null ? null : confidence.toFixed(2)]
    .filter(Boolean)
    .join(" · ");

export const isChange = (prev, next) => !prev || prev.model !== next.model || prev.placement !== next.placement;

export function titleFromTranscript(text) {
  const hit = text.split("\n").reverse().find((line) => line.includes('"ai-title"'));
  try {
    return hit ? JSON.parse(hit).aiTitle ?? "" : "";
  } catch {
    return "";
  }
}
