# MatchEdge Backend

Football match analysis + live tracking backend. Includes a Poisson model
with Dixon-Coles correction, real team-based attack/defense ratings,
multi-bookmaker odds comparison, market blending, and a caching layer.

---

## 1. Folder Structure

```
matchedge-backend/
├── src/
│   ├── config/config.js          # all settings are read from here
│   ├── db.js                     # MongoDB (Mongoose) connection
│   ├── models/
│   │   ├── User.js               # user account schema (username, email, bcrypt password hash, verification/reset tokens)
│   │   ├── Note.js               # a user's saved betting note
│   │   └── Favorite.js           # a user's favorited match
│   ├── middleware/
│   │   └── authMiddleware.js     # requireAuth - verifies the JWT on protected routes
│   ├── utils/
│   │   ├── fetchWithTimeout.js   # wraps external API calls with a timeout
│   │   ├── cache.js              # cache-aside pattern (node-cache)
│   │   └── textNormalize.js      # matches team names across accented alphabets (SE/NO/FI/CH etc.)
│   ├── services/
│   │   ├── footballApiService.js # fixtures, H2H, form, live data, injuries, standings
│   │   ├── oddsApiService.js     # multi-bookmaker odds, Kelly, market blending, odds history
│   │   ├── poissonService.js     # Poisson model, Dixon-Coles correction, corner estimate
│   │   ├── statsService.js       # home/away form, first-half tendency, injury/fatigue/momentum/home-advantage
│   │   ├── motivationService.js  # motivation multiplier derived from standings "description" field
│   │   ├── liveXgService.js      # live approximate xG, momentum, goal proximity
│   │   ├── authService.js        # password hashing (bcrypt), JWT sign/verify, verification/reset tokens
│   │   ├── emailService.js       # sends verification + password-reset emails via Resend
│   │   └── analysisEngine.js     # THE shared engine that combines the whole model - used by both the route and the cron job
│   ├── cron/precomputeJob.js     # precompute (via analysisEngine) + odds snapshot cron
│   ├── routes/
│   │   ├── auth.js               # register/login/verify-email/forgot-password/reset-password
│   │   ├── notes.js               # GET/POST/PATCH/DELETE /api/notes (requires login)
│   │   ├── favorites.js          # GET/POST/DELETE /api/favorites (requires login)
│   │   ├── matches.js            # GET /api/matches
│   │   ├── analysis.js           # GET /api/analysis/:fixtureId
│   │   ├── live.js               # GET /api/live, /api/live/:fixtureId
│   │   ├── results.js            # GET /api/results?date=... (includes half-time score)
│   │   └── oddsHistory.js        # GET /api/odds-history/:sportKey
│   └── server.js                 # entry point
├── .env.example                  # copy this to .env
└── package.json
```

---

## 2. Where to Get Your API Keys (Which Key Goes Where)

All keys go into a `.env` file. For local testing, copy `.env.example`
to `.env` and fill it in. When deploying to Render, you'll enter these
same values one by one under **Render Dashboard > Environment** (step-by-step
instructions below).

| Variable | Where to Get It | What It's For |
|---|---|---|
| `API_FOOTBALL_KEY` | Sign up for the free "Basic" plan at https://rapidapi.com/api-sports/api/api-football - it gives you the key as "X-RapidAPI-Key" | Fixtures, H2H, form, injuries, standings, live match data |
| `ODDS_API_KEY` | https://the-odds-api.com/ - free plan gives ~500 requests/month | Multi-bookmaker odds comparison |
| `THESPORTSDB_KEY` | https://www.thesportsdb.com/api.php - the free test key `3` works out of the box, or register for your own | Fallback/backup data source |

**Important:** API-Football's free plan has a low daily request limit
(typically 100/day). The caching layer exists specifically to protect
this limit - it does not re-fetch the same data on every request. If
your traffic grows, you'll eventually need a paid plan.

**Multiple sources / automatic failover:** API-Football can actually be
reached through two independent free-tier quotas, since it's offered
both by RapidAPI and directly by its own provider:

| Extra variable | Where to Get It | Counts as |
|---|---|---|
| `API_FOOTBALL_KEY_2` | A second RapidAPI account, same signup page as above | A second, separate RapidAPI quota (100/day) |
| `API_FOOTBALL_DIRECT_KEY` | Sign up directly at https://dashboard.api-football.com/register (no RapidAPI account needed) - copy the key shown on your dashboard | A separate direct api-sports.io quota (100/day), independent of RapidAPI |

Fill in either or both, and the backend automatically retries a request
with the next source when the current one hits its quota (HTTP 429) -
each configured source adds another ~100 requests/day, with zero code
changes needed on your end. Note: combining multiple free accounts to
bypass rate limits may not align with each provider's terms of service
- this is offered as a technical option, the decision is yours. A paid
plan is the officially supported way to raise your limit.

---

## 3. Setting Up User Accounts (Database)

Since this project is being used commercially, it now has real user
registration and login instead of everything being anonymous. This
needs two more things in your `.env`: a database connection string and
a secret key for signing login tokens.

### A. Create a free MongoDB Atlas cluster

1. Go to https://www.mongodb.com/cloud/atlas/register and sign up
   (email or Google account both work)
2. When asked to create a cluster, pick the **free "M0" tier** - no
   credit card required, and it never expires (unlike some other free
   database trials)
3. Under **Security > Database Access**, click "Add New Database User"
   - create a username and password (write these down, you'll need
   them for the connection string - they're separate from your Atlas
   login)
4. Under **Security > Network Access**, click "Add IP Address" and
   choose "Allow Access from Anywhere" (`0.0.0.0/0`) - this is
   necessary because Render's servers don't have a fixed IP
5. Go to your cluster's **Connect** button > "Drivers" > copy the
   connection string, it looks like:
   `mongodb+srv://your_db_user:your_db_password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Replace `your_db_user` and `your_db_password` in that string with
   the database user you created in step 3, and paste the whole thing
   as `MONGODB_URI` in your `.env`

### B. Generate a JWT secret

This is just a long random string used to cryptographically sign login
tokens - it doesn't need to be memorable, just unique and private.
Generate one by running this in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the output as `JWT_SECRET` in your `.env`.

### C. Auth endpoints

| Endpoint | Body | Description |
|---|---|---|
| `POST /api/auth/register` | `{ "username", "email", "password" }` | Creates an account, sends a verification email, returns a token |
| `POST /api/auth/login` | `{ "username", "password" }` | Returns a token if credentials are correct |
| `GET /api/auth/me` | (send `Authorization: Bearer <token>` header) | Confirms whether a token is still valid |
| `POST /api/auth/verify-email` | `{ "token" }` | Marks the account's email as verified |
| `POST /api/auth/resend-verification` | `{ "email" }` | Resends the verification email |
| `POST /api/auth/forgot-password` | `{ "email" }` | Sends a password-reset email if that address is registered |
| `POST /api/auth/reset-password` | `{ "token", "newPassword" }` | Sets a new password using a valid reset token |

Passwords are never stored in plain text - only a bcrypt hash is saved
to the database. The token returned by register/login is a JWT; the
frontend stores it and sends it back as `Authorization: Bearer <token>`
on requests that need to know who's logged in.

**Note:** the core data endpoints (`/api/analysis`, `/api/live`,
`/api/results`, etc.) do NOT currently require login - they stay public
so the app still works before you've built out user-specific features.
Notes and Favorites (below) DO require login, since they're personal
to each account.

### D. Sending Emails (Verification + Password Reset)

Verification and password-reset emails are sent through **Resend**, a
transactional email API with a generous free tier.

1. Sign up free at https://resend.com/signup
2. In the dashboard, go to **API Keys** and create one
3. Paste it as `RESEND_API_KEY` in your `.env`
4. Leave `EMAIL_FROM` as the default (`onboarding@resend.dev`) while
   testing - it works immediately with zero setup. Before a real
   launch, verify your own domain under **Domains** in Resend's
   dashboard, then change `EMAIL_FROM` to an address on it (e.g.
   `MatchEdge <noreply@yourdomain.com>`) - this avoids emails landing
   in spam and looks more professional to users.
5. Set `FRONTEND_URL` to wherever you end up hosting the frontend
   files (see the frontend README) - the verification and reset links
   inside the emails point to `{FRONTEND_URL}/verify.html?token=...`
   and `{FRONTEND_URL}/reset-password.html?token=...`

**If `RESEND_API_KEY` is left empty:** registration, login, and
everything else still works - the backend just logs a warning and
silently skips sending the email instead of failing. This lets you
build and test everything else before setting up email.

### E. Notes & Favorites (Now Account-Based)

Personal betting notes and favorited matches are now stored in the
database, tied to the logged-in user - they sync across devices
instead of living only in one phone's browser storage like before.

| Endpoint | Body | Description |
|---|---|---|
| `GET /api/notes` | — | Lists the logged-in user's notes |
| `POST /api/notes` | `{ "match", "selection", "comment", "fixtureId", "matchDate" }` | Creates a note |
| `PATCH /api/notes/:id` | `{ "result": "win"/"loss"/null, "autoChecked": bool }` | Updates a note's result |
| `DELETE /api/notes/:id` | — | Deletes a note |
| `GET /api/favorites` | — | Lists the logged-in user's favorited matches |
| `POST /api/favorites` | `{ "fixtureId", "homeTeam", "awayTeam" }` | Adds (or re-adds) a favorite |
| `DELETE /api/favorites/:fixtureId` | — | Removes a favorite |

All of these require the `Authorization: Bearer <token>` header - they
will return `401` without a valid, logged-in token.

---

## 4. Local Setup (For Testing)

```bash
cd matchedge-backend
npm install
cp .env.example .env
# open .env and fill in your keys
npm start
```

The server starts at `http://localhost:10000`.
Test it at: `http://localhost:10000/health`

---

## 5. Deploying to Render (Step by Step)

### A. Push the Code to GitHub
1. Create a new repo on GitHub (e.g. `matchedge-backend`)
2. Upload every file in this folder to that repo (you can do this from
   mobile too, via GitHub's web UI: "Add file > Upload files" - just
   drag the files in, keeping the folder structure)

### B. Create a New Service on Render
1. Go to https://render.com, sign in with your GitHub account
2. Click "New +" > "Web Service"
3. Select the repo you just uploaded
4. Settings:
   - **Name:** matchedge-backend (or whatever you like)
   - **Region:** pick the one closest to your users
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** see the "Keeping the Server Awake" section below

### C. Enter the Environment Variables
On the service page, go to the **Environment** tab and add each of
the following ONE BY ONE using "Add Environment Variable":

```
API_FOOTBALL_KEY = your_real_key
API_FOOTBALL_HOST = api-football-v1.p.rapidapi.com
ODDS_API_KEY = your_real_key
THESPORTSDB_KEY = 3
CACHE_TTL_STATIC = 900
CACHE_TTL_LIVE = 45
CACHE_TTL_PRECOMPUTED = 21600
ODDS_SNAPSHOT_CRON = 0 */3 * * *
MAX_PRECOMPUTE_FIXTURES_PER_RUN = 15
MONGODB_URI = your_mongodb_atlas_connection_string
JWT_SECRET = your_generated_random_string
JWT_EXPIRES_IN = 30d
RESEND_API_KEY = your_resend_api_key
EMAIL_FROM = MatchEdge <onboarding@resend.dev>
FRONTEND_URL = https://wherever-you-host-the-frontend.com
NODE_ENV = production
```

**Note:** you can leave `TRACKED_LEAGUES` unset - if empty, the wide
default league list (~25 leagues + UEFA competitions) built into
`config.js` is used automatically.

**Note:** to enable automatic failover to extra API-Football sources,
also add `API_FOOTBALL_KEY_2` and/or `API_FOOTBALL_DIRECT_KEY` (see section 2).

5. Click "Create Web Service" - Render will build and deploy
   automatically. This takes a few minutes.

---

## 6. Keeping the Server Awake (Important)

On Render's **free** tier, web services fall asleep after 15 minutes
of no requests; the next request then takes roughly 30-60 seconds to
respond while the container spins back up.

**IMPORTANT:** Having the service ping itself from inside its own code
is NO LONGER RECOMMENDED. Render can treat that as "abnormal traffic
originating from the service" and may suspend the account over it.
This project does not include any such self-ping mechanism.

You have two realistic options:

**Option 1 - Upgrade to a paid plan (the most reliable fix)**
Render's "Starter" plan is about $7/month - on this plan the service
never sleeps and you get more RAM/CPU than the 512MB free tier. This
is the healthiest option once you have real users.

**Option 2 - Stay on the free tier, use an EXTERNAL uptime monitor**
A ping coming from OUTSIDE your service is not the "self-ping" Render
warns about - this is a completely safe and widely used approach.
Here is exactly how to set one up, using either of two free services:

**Using cron-job.org (recommended, no account limits):**
1. Go to https://cron-job.org/en/ and click "Sign up" (top right)
2. Register with your email and confirm your account (check your inbox
   for the confirmation link)
3. Once logged in, click "Create cronjob"
4. Fill in the form:
   - **Title:** anything, e.g. "MatchEdge keep-alive"
   - **URL:** `https://your-service-name.onrender.com/health`
   - **Execution schedule:** choose "Every X minutes" and set it to
     every 10-14 minutes (must be under 15 minutes)
5. Save. That's it - no API key needed, the free plan is enough for this.

**Using UptimeRobot (alternative, also free):**
1. Go to https://uptimerobot.com/ and click "Sign Up" (or "Register")
2. Register with your email, confirm via the verification email
3. Once logged in, click "+ Add New Monitor"
4. Fill in the form:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** anything, e.g. "MatchEdge"
   - **URL:** `https://your-service-name.onrender.com/health`
   - **Monitoring Interval:** 5 minutes (the free plan's minimum, well
     under Render's 15-minute sleep threshold)
5. Click "Create Monitor". No API key is required for this either -
   the account/monitor setup itself is the whole "key".

Either service works purely through your account - there is no
separate "ping API key" to copy anywhere in this project's code; the
external monitor calls your public `/health` URL directly.

**Whichever you choose:** once real traffic grows, moving to Option 1
(paid plan) is worth it - it removes the sleep issue entirely and also
gets you past the 512MB RAM ceiling.

---

## 7. How Many Concurrent Users Can This Handle? (Capacity & Quota)

This question splits into two separate layers - "how many users can
the server handle" and "how many users can the external API quota
handle" - and they have very different limits.

### A. Server capacity (Render free tier: 512MB RAM, 0.1 vCPU)

This project is mostly a lightweight JSON API reading from cache, so
it doesn't stress the CPU much (the Poisson math is cheap). For this
kind of load, the free tier comfortably handles roughly **a few dozen
concurrent users**. The exact number needs load testing to pin down,
but it's plenty for a small/personal product's typical traffic. If you
outgrow it, you'll see slowdowns first, then memory errors - at that
point move to Render's "Starter" ($7) or "Standard" ($25, 2GB RAM/1
CPU) plan.

### B. External API quota - THE REAL BOTTLENECK

**Important architectural point:** thanks to the caching layer, the
number of users looking at the SAME match does NOT increase quota
usage. If 500 people open the analysis page for the same match at
once, that costs the same external API usage as 1 person (everyone
after the first reads from cache). So the real constraint isn't "how
many users" - it's "how many DIFFERENT matches/leagues are being
analyzed at the same time."

Rough estimate based on that:

- **API-Football free plan:** ~100 requests/day. With the 15-minute
  cache TTL, this covers dozens of different matches being analyzed
  per day - but if more than ~100 distinct matches/teams are queried
  in one day, the quota runs out.
- **The Odds API free plan:** ~500 requests/month. The smart filter
  (only checking leagues that actually have matches that day) usually
  keeps this sufficient, but it can be exceeded during busy weeks (see
  the discussion in section 5 of the original planning conversation).

**Summary:** growing user count is not a problem (caching absorbs it);
the problem only appears as the NUMBER OF DIFFERENT MATCHES/LEAGUES
tracked grows. As the product scales, you'll eventually need
API-Football's paid plan (starts at a few dollars/month, substantially
raises the daily request limit) - independent of how many users you have.

---

## 8. Endpoint Summary

| Endpoint | Description |
|---|---|
| `GET /health` | Server health check (used by the external uptime monitor, see section 6) |
| `GET /api/matches?date=2026-09-09` | Fixtures for a given date |
| `GET /api/analysis/:fixtureId?home=..&away=..&league=..&season=..&homeTeamName=..&awayTeamName=..&sportKey=..` | Full pre-match analysis - probabilities, market predictions, first-half tendency, corners, motivation, form, fatigue, injuries, market blend |
| `GET /api/live` | All matches currently live |
| `GET /api/live/:fixtureId` | Live score, xG, momentum, goal proximity, possession, value alert for one match |
| `GET /api/results?date=2026-09-09` | That day's results, including half-time score (used by the Home, Results, and Notes screens) |
| `GET /api/odds-history/:sportKey` | Accumulated odds history for a league (for charting) |

### `/api/analysis` query parameters
- `home`, `away` (required): API-Football team IDs
- `league`, `season` (optional): needed for the standings-based motivation calculation
- `homeTeamName`, `awayTeamName` (optional): needed to match against The Odds API for market blending
- `sportKey` (optional, defaults to `soccer_epl`): The Odds API sport key

### `/api/analysis` response fields, briefly
- `matchProbabilities`: FINAL (model + market blended) 1X2 probabilities
- `modelOnlyProbabilities`: the model's raw prediction (for comparison)
- `marketImpliedProbabilities`: probability implied by bookmaker odds (if available)
- `marketProbabilities`: over/under 2.5, BTTS yes/no
- `cornerMetrics`: expected minimum corners + probability of over 8.5 (a derived estimate, not real corner data)
- `firstHalfProximity`: which side is more likely to score the first-half goal (own history + recency-weighted H2H)
- `injuries`, `homeAwayForm`, `motivation`, `fatigue`, `streak`, `homeAdvantageMultiplier`: all of the model's intermediate steps, exposed for transparency

---

## 9. Current Model Status and Known Limitations

The expected-goals (lambda) calculation runs through this pipeline:
`base attack/defense (real home/away scoring average) → injury penalty → fatigue multiplier → form streak (momentum) → team-specific home advantage → motivation multiplier`

Dixon-Coles low-score correction and market-odds blending are then applied on top.

**Known limitations (worth knowing honestly):**
- Most of the penalty/bonus multipliers (injury: 2%/player, fatigue: 7%, motivation: 5-12%, etc.) are educated estimates - they have NOT been calibrated against real results via **backtesting**. This is the single most valuable next step for this project (how to do it was discussed in detail during planning).
- The corner estimate is not real corner statistics - it's derived from expected goal tempo, since fetching real historical corner data would cost one extra API call per past match (too expensive on the free quota).
- xG (both live and historical) is derived from goal counts, not real "expected goals" data - a genuine xG feed would require a separate paid provider like Sportmonks (Understat has no official API, only scraping, which carries ToS risk and is not recommended).
- Team-name matching issues (especially in countries using extended Latin alphabets like Sweden/Norway/Finland/Switzerland) are handled by `utils/textNormalize.js`, but this kind of normalization is never 100% guaranteed.
- **Important - quota impact:** `analysisEngine.js` is used by BOTH the `/api/analysis` route and `precomputeJob.js` (a deliberate consistency choice), which means precomputation now costs 4-5 API-Football requests per match (it used to be 2). `MAX_PRECOMPUTE_FIXTURES_PER_RUN` (default 15) was added because of this - the day's soonest 15 matches are prioritized, and the rest fall back to the realtime path when a user opens them. Raise this number if you move to a paid plan.

---

## 10. Next Steps

- **Backtesting script** - measure how accurate the model actually was against a past season's results, and use that to calibrate the constants (LEAGUE_AVG_HOME_GOALS, DEFAULT_RHO, penalty multipliers)
- Connect the frontend (the `matchedge-frontend` folder) to these endpoints using your real Render URL
- Add a payment/subscription layer (Stripe) to gate premium features (live value alerts, live xG chart) behind a paid tier
- Referee statistics (would require an additional/paid data source)
