export function profileDescriptions(profiles = {}) {
  return Object.fromEntries(Object.entries(profiles).map(([name, p]) => [name, p.description ?? ""]));
}

export function claudeProfileFlags(profile, home) {
  const claude = profile?.claude;
  if (!claude) return [];
  const flags = ["--strict-mcp-config"];
  if (claude.mcpConfig) flags.push("--mcp-config", claude.mcpConfig.replace(/^~(?=\/)/, home));
  if (claude.tools?.length) flags.push("--tools", claude.tools.join(","));
  return flags;
}
