async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = { status: "fulfilled", value: await worker(items[current], current) };
      } catch (error) {
        results[current] = { status: "rejected", reason: error };
      }
    }
  }

  const runners = [];
  const size = Math.min(limit, items.length);
  for (let i = 0; i < size; i += 1) {
    runners.push(runner());
  }
  await Promise.all(runners);
  return results;
}

module.exports = { runWithConcurrency };
