export function createBufferedLog(write) {
  const lines = [];
  let queue = Promise.resolve();
  return (entry) => {
    lines.push(JSON.stringify({ at: new Date().toISOString(), ...entry }));
    queue = queue.then(() => write(`${lines.join("\n")}\n`)).catch(() => {});
    return queue;
  };
}
