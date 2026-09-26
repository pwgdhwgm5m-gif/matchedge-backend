# Forebet comparison — 26 September 2026

Public Forebet UEFA Nations League predictions were captured before kickoff
from https://www.forebet.com/en/prediction-lists/international . SoccerEdge
figures are pre-match analyses for the same fixtures. The old column is the
venue-regularized model; the new column is
`analysis-v4-historical-shrinkage-2026-09`.

| Match | Forebet 1/X/2 | Old 1/X/2 | New 1/X/2 | Forebet goals | Old goals | New goals |
| --- | --- | --- | --- | ---: | ---: | ---: |
| England–Spain | 27/41/32 | 26.1/27.9/46.0 | 26.7/27.5/45.7 | 3.34 | 2.38 | 2.52 |
| Czech Republic–Croatia | 32/45/23 | 28.2/28.0/43.8 | 32.4/27.0/40.6 | 2.83 | 2.76 | 2.66 |
| Albania–Belarus | 24/48/28 | 61.9/23.6/14.5 | 52.4/27.9/19.7 | 1.92 | 1.87 | 2.02 |
| North Macedonia–Switzerland | 53/28/19 | 14.2/21.7/64.2 | 16.6/25.1/58.4 | 1.97 | 2.37 | 2.13 |

Mean absolute distance to Forebet: 1/X/2 **19.64 → 16.58 percentage
points** over twelve outcomes; total goals **0.370 → 0.312** over four
matches. England–Spain over 2.5 changed **43.3% → 46.5%**, while Forebet
published **67%**. These four matches are a diagnostic sample, not a claim
about accuracy. Forebet's proprietary weights are unknown; its public
description mentions a long historical database, temporary form and Poisson.

The model change corrects a genuine zero-rate defect (Belarus had a 0.00
expected-goals rate after five scoreless matches) and missing Czechia history.
Forebet's 1/X/2 percentages remain far apart from the bookmaker consensus in
some fixtures. Do not force the production 1/X/2 probabilities toward a
competitor without prospective settled-match calibration and Brier comparison.
Continue collecting frozen forecasts for the same fixtures across leagues.
