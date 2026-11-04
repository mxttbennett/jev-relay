export function createBufferedLog(write, existing = "") {
  const lines = existing.split("\n").filter(Boolean);
  let queue = Promise.resolve();
  return (entry) => {
    lines.push(JSON.stringify({ at: new Date().toISOString(), ...entry }));
    queue = queue.then(() => write(`${lines.join("\n")}\n`)).catch(() => {});
    return queue;
  };
}
