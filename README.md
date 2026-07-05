# json/extract

A React + Vite port of the JSON extract/trim tool, deployable to Netlify.
Cloud sync now uses **Stackby** instead of Upstash.

## Run locally

Cloud sync goes through a Netlify Function (`netlify/functions/stackby.js`),
which plain `vite dev` does not serve. Use the Netlify CLI for local dev so
functions work too:

```bash
npm install -g netlify-cli   # once
npm install
netlify dev
```

`vite dev` on its own still works for everything except cloud sync (it'll
fall back to localStorage and the footer will say the function couldn't be
reached).

## Build

```bash
npm run build
```

Outputs to `dist/`.

## Deploy to Netlify

Two options:

1. **Netlify CLI**
   ```bash
   npm install -g netlify-cli
   netlify deploy --prod
   ```
2. **Git-based deploy** — push this folder to a GitHub repo and connect it in
   the Netlify dashboard. `netlify.toml` already sets the build command
   (`npm run build`) and publish directory (`dist`).

Stackby credentials are **server-side environment variables**, never
entered in the browser or stored in `localStorage`. Set these in your
Netlify site's **Site configuration → Environment variables**:

| Variable             | Required | Notes                                 |
| -------------------- | -------- | -------------------------------------- |
| `STACKBY_API_KEY`    | yes      | from your Stackby account settings     |
| `STACKBY_STACK_ID`   | yes      | the ID in the Stackby URL              |
| `STACKBY_TABLE_NAME` | no       | defaults to the app sessions table      |

For local dev with `netlify dev`, create a `.env` file in this folder (see
`.env.example`) — Netlify CLI loads it automatically and it's already
covered by `.gitignore`, so it won't get committed.

The browser only ever sends `{action, sessionKey, value}` to
`/.netlify/functions/stackby`; the function reads the credentials from
`process.env` and does the real HTTPS call to Stackby server-side (see "Why
a function?" below). If the env vars aren't set, the function replies with
`{configured: false}` and the app transparently falls back to
`localStorage`.

### Why a function?

A direct browser `fetch()` to `stackby.com` fails with a CORS error before
the request result (auth, data, anything) is even visible to the page —
Stackby's API isn't set up to be called from arbitrary websites' JavaScript.
Routing the call through a Netlify Function sidesteps that: the browser
talks to your own domain (which Netlify always allows), and the function
does the real HTTPS call to Stackby from the server side, where CORS
doesn't apply.

## Setting up Stackby as the database

The app emulates a simple key/value store on top of a normal Stackby table
(Stackby itself is a spreadsheet-style database, so this is the closest
analog to Upstash's `SET`/`GET`).

1. Create a Stack in Stackby (or use an existing one) and note its **Stack
   ID** — it's the string in the Stackby URL right after `/`, e.g.
   `stackby.com/{stackId}/...`.
2. Inside that stack, create a table for app sessions, or set
   `STACKBY_TABLE_NAME` to the table you want to use. The table needs exactly two
   columns:
   - `SessionKey` — single line text
   - `Payload` — long text
3. Generate a Stackby **API key** from your account settings.
4. Set `STACKBY_API_KEY`, `STACKBY_STACK_ID`, and, when needed,
   `STACKBY_TABLE_NAME` as environment variables on Netlify
   (and/or in a local `.env` file for `netlify dev`).
5. The app autosaves your workspace tabs to that table ~700ms after you stop
   typing, using one row keyed by a fixed session key. "Force Fetch from
   Cloud" pulls the latest saved row back down (handy for syncing across
   devices/browsers). If the env vars aren't set, the app transparently
   falls back to `localStorage` in the current browser.

## What changed from the original single-file version

- Split into a proper Vite/React project (`src/App.jsx`, `src/lib/*.js`)
  instead of one big HTML file with inline `<script>`.
- `netlify/functions/stackby.js` is a Netlify Function that does the actual
  Stackby REST calls (row lookup by `SessionKey`, then
  `rowupdate`/`rowcreate`/`rowdelete`) — added after direct browser calls to
  Stackby failed on CORS.
- `src/lib/stackby.js` now just posts `{action, sessionKey, value}` to that
  function and relays the response; it no longer talks to `stackby.com`
  itself.
- Stackby credentials moved out of the browser entirely: the function reads
  `STACKBY_API_KEY` / `STACKBY_STACK_ID` / `STACKBY_TABLE_NAME` from
  `process.env` instead of accepting them from the client, and the app no
  longer has an API-key input field or a `localStorage`-cached config.
- Fixed a bug where `rowcreate`/`rowupdate`/`rowdelete` sent a `{"rows": [...]}`
  body — Stackby's API actually expects `{"records": [...]}`, which is why
  saves were failing with `HTTP 400: Request body must include a 'records'
  array`.
- All the JSON-wrangling logic (span detection, nested array discovery,
  keyword search, positional/keyword trimming, date-based sort) is ported
  as-is into `src/lib/jsonTools.js`.
