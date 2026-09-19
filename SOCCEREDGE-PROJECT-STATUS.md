# SoccerEdge Pro — Project Status

Last updated: 2026-09-19

This file is the persistent handoff/status record for future ChatGPT sessions.
Before changing SoccerEdge Pro, read this file and verify the current GitHub + Render state. Never assume a deploy is live without checking Render.

## Repositories
- Frontend: pwgdhwgm5m-gif/matchedge-frontend
- Backend: pwgdhwgm5m-gif/matchedge-backend
- Backend service: https://matchedge-backend-kujb.onrender.com
- Render service ID: srv-daji2mbm8hqs738cjk40
- Render workspace ID: tea-daaqukc9v7es739kj09g

## Product direction
SoccerEdge Pro is a compact mobile-first football match intelligence/prediction product. Prefer free/no-key data sources where practical. Never fabricate missing form, xG, live statistics or confidence. If reliable data is unavailable, show a short unavailable/no-data state instead.

## Analysis/data rules
- Current season is weighted more heavily; 2025/26 can support 2026/27.
- Early season: fewer than 5 completed league matches => materially reduce confidence; do not invent form.
- Factors include standings, home/away, Elo, form, H2H, common opponents, first/second-half goals, shots/SOT, corners and available odds.
- Core markets include 1/X/2, team 1.5 goals, first-half and second-half goal markets, which half has more goals, and corners.
- Football-Data.co.uk is used for completed-history/odds/stat support where available.
- Turkish Süper Lig also uses the tested TFF-derived source for current standings/fixtures/team list.

## Live prediction behavior
Backend /api/live/:fixtureId now returns a stable livePrediction payload.
- Prefer real live xG when available.
- Otherwise estimated live xG / goal proximity may be derived from observed live events such as shots on target and corners.
- Do not manufacture a prediction from empty/50-50 fallback data.
- Frontend must never render undefined values.
- If there is insufficient evidence, display "No live prediction".
- Goal Proximity bar: Home side is yellow; Away side is red. Both segments must always retain their colors according to their percentage.

Relevant commits:
- Backend 6272c9d — stable real-data live prediction payload
- Backend 99366a6 — observed live xG estimate / goal proximity
- Frontend c3acbb7 — remove undefined live cards
- Frontend fab0eec — show live xG and goal proximity
- Frontend 247b289 — fix Away goal-proximity bar red color

## Localization
When English is selected, no Turkish UI labels should remain.
Examples:
- Ana Ekran -> Home
- Skor -> Scores
- Maçlar -> Matches
- Favoriler -> Favorites
- Ev -> Home
- Dep / Deplasman -> Away
- Bitti -> Finished
- İY / MS -> HT / FT
- Turkish corner labels -> English equivalents

Shared localization is handled through language-selector.js.
Relevant frontend commit: 144d32d.

## Mobile/browser layout
The product must remain usable on iPhone Safari, iOS Chrome/Firefox, Android Chrome and Android Firefox.
Important rules:
- No horizontal page overflow.
- Cards must not be clipped.
- Long team names wrap safely.
- Match time, score and status remain consistently aligned.
- Bottom navigation must respect safe-area and must not cover page content.
- Mobile Top Predictions / Live cards should show complete information rather than being clipped by an inner scroll.

Relevant commits:
- Frontend 7f23eb0 — Android home cards scrolling and score alignment
- Frontend 87c2c10 — shared cross-browser responsive compatibility layer

## Admin
Admin console: /admin on backend service.
Existing admin API is protected and shows users/recent login activity.
Approximate login location is IP-derived without requesting browser precise-location permission.
Raw IP is not stored by the login audit flow; IP is hashed.
Location is approximate and may be affected by VPN/mobile carrier routing.
Old login rows with no location cannot reliably be backfilled from a hash.
Actual session duration is NOT currently tracked; do not present lastActiveAt as session duration.

Relevant backend commits:
- b31b5bc — admin console
- b53be15 — serve protected admin console
- f1c88c6 — approximate IP location without browser geolocation prompt
- ab73d05 — mobile admin activity layout
- 2cba821 — proxy-header + fallback province/district resolution

Do not put admin passwords, JWT secrets, API secrets or other credentials in this repository/status file.

## UI preferences
- Compact cards; avoid long explanatory copy.
- Do not display fabricated confidence.
- Prefer "No data" / "No live prediction" to invented values.
- Analysis button should toggle open/closed.
- Date navigation target is yesterday/today/tomorrow (-1/0/+1).
- Keep SoccerEdge Pro naming consistent.
- English mode must be fully English.

## Deployment rule
A GitHub commit is NOT proof that production is live.
For every deployment-related claim:
1. Check Render.
2. Match the deployed commit SHA.
3. Only say LIVE when Render reports the intended commit as live.

## Latest known code heads at time of this file
- Frontend: 87c2c10ad84ee2a6ea950bbee1156af55c9832be — Add cross-browser responsive compatibility layer
- Backend: 99366a6fcdc3f990ff8211ecd7714e303633b441 — Use observed live xG estimate for goal proximity predictions

These are code-head references, not a guarantee of current production state. Re-check GitHub and Render in every new session.

## New-session instruction
User can say:
"SoccerEdge Pro status dosyasını oku, GitHub ve Render'daki son durumu doğrula ve kaldığımız yerden devam et."

The assistant should then read this file first, inspect newer commits if any, verify Render before deploy claims, and continue from the current code rather than rebuilding from an older version.
