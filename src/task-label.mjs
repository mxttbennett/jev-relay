const MAX_CHARS = 60;

export function taskLabel(prompt) {
  const firstLine = (prompt ?? "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).find(Boolean);
  if (!firstLine) return "Background task";
  return firstLine.length > MAX_CHARS ? `${firstLine.slice(0, MAX_CHARS - 1)}…` : firstLine;
}
