// Start every source together, then handle each response without waiting for
// slower sources. Keep a settled result for every source so a failed fallback
// cannot prevent the next monitor cycle.
async function runGoalSources(sources, onMatches) {
  return Promise.allSettled(sources.map(async ({fetch, transform}) => {
    const started = Date.now();
    const result = await fetch();
    if (result.ok) await onMatches(transform(result), {
      fetchMs: Date.now() - started,
      cached: result.cached === true || result.fromCache === true,
      fetchedAt: result.fetchedAt
    });
  }));
}

module.exports = {runGoalSources};
