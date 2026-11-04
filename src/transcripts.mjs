import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const TAIL_BYTES = 1_000_000;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const INJECTED = /^(<|# AGENTS\.md instructions)/;

function readTail(path) {
  const fd = openSync(path, "r");
  try {
    const { size } = fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    return size > length ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

export function cleanText(text) {
  const trimmed = (text ?? "").replace(REMINDER, "").trim();
  return trimmed && !INJECTED.test(trimmed) ? trimmed : "";
}

/**
 * Reads the tail of a JSONL transcript. `parseLine` maps one record to
 * { role, text, tokens, at } (any field optional) or null to skip it.
 * Tokens and time keep the latest value seen; turns keep the last few prose turns.
 */
export function readTranscript(path, parseLine, maxTurns = 3) {
  const empty = { contextTokens: 0, lastAt: 0, turns: [] };
  let raw;
  try {
    raw = readTail(path);
  } catch {
    return empty;
  }
  const snapshot = { ...empty, turns: [] };
  for (const line of raw.split("\n")) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = parseLine(record);
    if (!parsed) continue;
    if (parsed.tokens != null) snapshot.contextTokens = parsed.tokens;
    if (parsed.at) snapshot.lastAt = parsed.at;
    const text = cleanText(parsed.text);
    if (text && parsed.role) snapshot.turns.push({ role: parsed.role, text });
  }
  snapshot.turns = snapshot.turns.slice(-maxTurns);
  return snapshot;
}

const textOf = (content, types) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => types.includes(block.type))
    .map((block) => block.text ?? "")
    .join("\n");
};

export function claudeLine(record) {
  if ((record.type !== "user" && record.type !== "assistant") || record.isSidechain) return null;
  const usage = record.message?.usage;
  const tokens = usage
    ? (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
    : null;
  return {
    role: record.type,
    text: textOf(record.message?.content, ["text"]),
    tokens,
    at: tokens != null ? Date.parse(record.timestamp) || 0 : 0,
  };
}

export function codexLine(record) {
  const at = Date.parse(record.timestamp) || 0;
  if (record.type === "event_msg" && record.payload?.type === "token_count") {
    const tokens = record.payload.info?.last_token_usage?.input_tokens ?? null;
    return tokens == null ? null : { tokens, at };
  }
  if (record.type === "response_item" && record.payload?.type === "message") {
    const role = record.payload.role;
    if (role !== "user" && role !== "assistant") return null;
    return { role, text: textOf(record.payload.content, ["input_text", "output_text"]) };
  }
  return null;
}

export function sessionTitle(path) {
  try {
    const lines = readTail(path).split("\n").reverse();
    const hit = lines.find((line) => line.includes('"ai-title"'));
    return hit ? JSON.parse(hit).aiTitle ?? "" : "";
  } catch {
    return "";
  }
}
