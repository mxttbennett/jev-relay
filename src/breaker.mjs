export function createBreaker({ now = Date.now, threshold = 2, cooldownMs = 120_000, read, write }) {
  const load = () => {
    try {
      return read() ?? {};
    } catch {
      return {};
    }
  };
  const save = (entries) => {
    try {
      write(entries);
    } catch {}
  };
  return {
    isOpen: (name) => (load()[name]?.openUntil ?? 0) > now(),
    fail(name) {
      const entries = load();
      const fails = (entries[name]?.fails ?? 0) + 1;
      entries[name] = { fails, openUntil: fails >= threshold ? now() + cooldownMs : 0 };
      save(entries);
    },
    succeed(name) {
      const entries = load();
      if (!(name in entries)) return;
      delete entries[name];
      save(entries);
    },
  };
}

export const memoryBreaker = (options = {}) => {
  let entries = {};
  return createBreaker({ ...options, read: () => entries, write: (next) => (entries = next) });
};
