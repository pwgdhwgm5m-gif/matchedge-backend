# Analysis and provider invariants

These checks run on every backend start and in the full GitHub test workflow.
An invalid release must fail before the Render service starts. Keep the tests
when changing providers, caching, historical form or probability calculations.

1. **Provider IDs are namespaced.** A SportsDB, BSD or SportMonks endpoint
   receives only its own verified fixture and team IDs. Matching numbers or
   a similar team name do not establish cross-provider identity. Competition,
   both team names and kickoff must agree before mapping two records.
2. **Recent means recent.** Advanced xG and other history use the latest
   completed games in date order, independent of upstream array order. Never
   select the tail of a newest-first list or include a future fixture.
3. **BSD quota is bounded.** Concurrent requests for the same endpoint share
   one upstream request. The process budgets at most 6,000 BSD requests per
   UTC day by default and stops when the provider reports 400 or fewer left.
   A 429 observes Retry-After. Missing fields stay missing when BSD is held
   back; the client must not invent possession or xG.
4. **Percentages have provenance.** The model's goal rates and score matrix
   feed the listed probabilities; bookmaker 1X2 odds can blend only when
   verified. A competitor's published percentage is a benchmark, never an
   input or a target hard-coded for one fixture. Compare frozen pre-match
   snapshots on settled games using Brier score and calibration by league.

If a rule changes, update the relevant unit test and document why before
deploying. `npm run verify:invariants` is also the `npm start` prerequisite.
