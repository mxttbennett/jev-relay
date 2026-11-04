const PATTERNS = [
  { re: /```[\s\S]*?```/g, label: "[code block]", strong: false },
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, label: "[email]", strong: true },
  { re: /\b(?:sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}/g, label: "[token]", strong: true },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, label: "Bearer [token]", strong: true },
  {
    re: /\b(?:Server|Data Source|Password|Pwd|AccountKey)\s*=\s*[^;\s]+;?/gi,
    label: "[connection]",
    strong: true,
  },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, label: "[ssn]", strong: true },
  { re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, label: "[phone]", strong: true },
  { re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, label: "[date]", strong: false },
  { re: /\b[A-Fa-f0-9]{32,}\b/g, label: "[hex]", strong: false },
  { re: /\b\d{6,}\b/g, label: "[id]", strong: false },
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redact(text, names = []) {
  const patterns = [...PATTERNS];
  const clean = names.filter(Boolean).map(escapeRegExp);
  if (clean.length) {
    patterns.push({
      re: new RegExp(`\\b(?:${clean.join("|")})\\b`, "gi"),
      label: "[name]",
      strong: true,
    });
  }
  let out = text;
  let hits = 0;
  for (const { re, label, strong } of patterns) {
    out = out.replace(re, () => {
      if (strong) hits += 1;
      return label;
    });
  }
  return { text: out, hits };
}
