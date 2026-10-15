# Rock Paper Scissors (Karo Junior)

Frontend (HTML/CSS/JS) + Netlify Functions (serverless) + Firebase Firestore
(Admin SDK) + the Vatar Games SDK v1.

Single-player works standalone. Multiplayer, purchases and Vatar session
verification all run inside a Lagos Life frame.

## What's in the box

- `index.html` / `app.js` / `style.css` — the game (single-player + multiplayer).
- `admin.html` / `admin.js` — the read-only admin dashboard, served at `/admin`.
- `audio.js` — Web Audio synth (SFX + a short melodic loop, no external assets).
- `logic.mjs` — pure helpers (challenge lifecycle, error classification, etc.).
- `vatar-bridge.js` — thin wrapper around the Vatar SDK.
- `netlify/functions/` — the backend:
  - `api.mjs` — all `/api/*` routes: session exchange, match register/play/state,
    purchase claim, entitlements, and the admin login/logout/stats endpoints.
  - `vatar-webhook.mjs` — Vatar webhook receiver (signature-verified, logs only).
  - `admin.mjs` — deprecated stub, kept to answer `/.netlify/functions/admin`
    with a 410 rather than a mystery 404. The live admin is the static SPA.
  - `_lib/` — shared server code (auth, Firestore, RPS rules, Vatar client,
    match state, purchases).

## Prerequisites

- Node 20+
- A Netlify account
- A Firebase project with Firestore enabled
- A Vatar (Lagos Life) developer draft with keys

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values (see below).
3. `npm run dev` — Netlify Dev serves the site + functions at http://localhost:8888.
4. `npm test` — runs `node --test tests/`.

## Environment variables

| Name | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase → Project settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase → Service accounts → new private key JSON |
| `FIREBASE_PRIVATE_KEY` | Same JSON, `private_key`. Paste with literal `\n`. |
| `TOKEN_SECRET` | Random hex, ≥ 16 chars. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Credentials for `/admin`. |
| `VATAR_SECRET` | `vtr_test_…` (sandbox) or `vtr_live_…` (after approval). Server only. |
| `VATAR_RESULTS_SECRET` | Shown with the Vatar keys. Used to sign match results. |
| `VATAR_WEBHOOK_SECRET` | `vtr_whsec_test_…` / `vtr_whsec_live_…`. Verifies webhook signatures. |
| `VATAR_API_BASE` (optional) | Override the Vatar API base URL. Defaults to `https://lagoslife.app/api/games/v1`. |
| `TURN_MS` (optional) | Per-turn deadline in ms. Default `20000`. |

Never put `VATAR_SECRET`, `VATAR_RESULTS_SECRET`, `VATAR_WEBHOOK_SECRET`,
`TOKEN_SECRET`, or `ADMIN_PASSWORD` in any frontend file. They live on the
server only.

## Firestore rules

The browser never talks to Firestore. Lock it down completely:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

All access goes through Netlify Functions using the Firebase Admin SDK.

## Deploying to Netlify

1. Push the repo to GitHub.
2. In Netlify: "Add new site" → import from Git.
3. Build command: leave blank. Publish directory: `.`. Functions directory:
   `netlify/functions`.
4. Add the environment variables under Site settings → Environment variables.
5. Deploy.

## Admin dashboard

Available at `https://<site>.netlify.app/admin`. Sign in with `ADMIN_USER` /
`ADMIN_PASSWORD`.

- The page is a static SPA (`admin.html` + `admin.js`).
- The API it calls lives under `/api/admin/*` and is authenticated by an
  HttpOnly, SameSite=Strict session cookie signed with `TOKEN_SECRET`.
- It is read-only: aggregate match counts, recent results, and recent Vatar
  settlement failures. It never mutates player data.

`GET /api/admin/stats` returns the same JSON the dashboard renders — useful
for scripting, as long as you carry the admin cookie.

## Purchases / cosmetics

The optional **Neon Arena** cosmetic is a one-off product. See
`NEON_ARENA_PRODUCT_ID` in `app.js` (defaults to `neon_arena`) — it must match
the product ID you create in the Vatar dashboard.

Required steps:

1. In the Vatar dashboard, create the product with ID `neon_arena`,
   name "Neon Arena Theme", price within ₦100–₦50,000, marked for sale.
2. Players tap the cosmetic button in the Multiplayer lobby.
3. Vatar's own pay sheet handles payment.
4. `POST /api/purchase/claim` (on this server) verifies the purchase with
   `GET /purchases/{id}`, grants the entitlement idempotently in Firestore,
   then marks the purchase delivered.
5. On init, `Vatar.purchases()` and `Vatar.onPurchase()` restore any paid
   purchases that weren't yet delivered.

The game remains fully playable without buying anything.

## Audio

- SFX are on by default. Music is off by default.
- Both toggles live on the menu screen footer.
- Audio only starts after the first user gesture.
- `Vatar.onPause` / `Vatar.onResume` stop and resume the music.
- To make it louder, bump `SFX_LEVEL` / `MUSIC_LEVEL` near the top of
  `audio.js`.

## Logo assets

- `/assets/logo.png` — default mark (yellow fist, cyan palm, magenta scissors
  on dark). Used in the masthead.
- `/assets/logo2.png` — optional neon mark. Auto-swapped in when the Neon
  Arena entitlement is applied. If this file is missing, the browser falls back
  to the alt text; gameplay is unaffected.

Both must be square, ideally 512×512 PNGs, and stored under `/assets/`.

## Tests

```
npm test
```

Runs `node --test tests/` — pure logic only, no network and no Firestore.
Covers RPS rules, share-code generation, challenge lifecycle, quick-match
gating, error classification, and audio preference merging.

## What's still gated by the platform

- **Staked matches** stay disabled until Vatar approves them for this game.
  Nothing client-side can turn them on.
- **Quick Match** returns `not_available` outside the sandbox and before the
  platform has enabled multiplayer for the reviewed version. The UI reports
  that clearly and recovers.
- **Live purchases** are verified end-to-end by the sandbox test flow; before
  submitting, run through the sandbox purchase once to tick the checklist.
```

