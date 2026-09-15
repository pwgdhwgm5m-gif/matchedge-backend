/**
 * Bir takımın son N maçını, analysisEngine.js'in beklediği
 * {ok, data:{response:[...]}} şeklinde döner — footballApi.getTeamForm()
 * ile aynı sözleşmeyi (contract) sağlar, böylece analysisEngine'de
 * kaynak değiştirmek tek satırlık bir çağrı farkı olur.
 */
async function getTeamFixturesForAnalysis(teamName, count = 15) {
  try {
    const fixtures = await getFixtures();
    const isMatch = (team) =>
      team?.name && team.name.toLowerCase().includes(String(teamName).toLowerCase());
    const teamFixtures = fixtures.filter(
      (f) => f.finished && (isMatch(f.home) || isMatch(f.away))
    );
    const lastFixtures = teamFixtures.slice(-count);
    return {
      ok: true,
      data: { response: adaptFixturesToApiFootballFormat(lastFixtures) },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
