# Rock Paper Scissors (Karo Junior) — rebuilt foundation

Frontend (HTML/CSS/JS) + Netlify Functions (serverless) + Firebase Firestore (Admin SDK).
Stage 1 only. No Vatar integration yet.

## Prerequisites
- Node 20+
- A Netlify account
- A Firebase project with Firestore enabled

## Local setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values.
3. `npm run dev` (starts Netlify Dev, serves the site + functions at http://localhost:8888).
4. `npm test` runs the pure game-logic tests.

## Environment variables
| Name | Where to get it |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase console → Project settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase console → Project settings → Service accounts → "Generate new private key" |
| `FIREBASE_PRIVATE_KEY` | Same JSON file as above, `private_key` field. Paste with literal `\n` — do not add real newlines. |
| `TOKEN_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Choose strong values for the /admin/stats endpoint |

## Firestore rules
Lock down the database so the browser cannot read/write anything directly.
All access goes through Netlify Functions using the Admin SDK.

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

## Netlify deployment
1. Push the repo to GitHub.
2. In Netlify: "Add new site" → import from Git.
3. Build command: leave blank. Publish directory: `.`. Functions directory: `netlify/functions`.
4. Add the environment variables above under Site settings → Environment variables.
5. Deploy. The site is at `https://<site>.netlify.app`; admin stats are at `/admin/stats`.

## Admin dashboard
`GET /admin/stats` returns JSON, protected by HTTP Basic Auth.
Do NOT rely on the URL being secret — the auth is what protects it.

## What is NOT in Stage 1
- Vatar SDK integration
- Wagering / currency / payouts
- Lagos Life session validation
- Quick Match / matchmaking queue
- Any monetisation
