import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LEGACY = [
  [".config", "jev-relay", "jev-relayer"],
  [".local/state", "jev-relay", "jev-relayer"],
];

export function migrateLegacyDirs(home = homedir()) {
  for (const [base, from, to] of LEGACY) {
    const source = join(home, base, from);
    if (!existsSync(source)) continue;
    try {
      cpSync(source, join(home, base, to), { recursive: true, force: false, errorOnExist: false });
      rmSync(source, { recursive: true, force: true });
    } catch {}
  }
}
