# json/extract

A React + Vite port of the JSON extract/trim tool, deployable to Cloudflare
Pages. Cloud sync uses **Baserow** as the backing database, via a Cloudflare
Pages Function.

## Run locally

Cloud sync goes through a Cloudflare Pages Function
(`functions/api/baserow.js`), which plain `vite dev` does not serve. Use
Wrangler for local dev so Functions work too:

```bash
npm install
npm run build
npx wrangler pages dev dist
# or: npm run pages:dev
```

Put your Baserow credentials in a `.dev.vars` file first (see
`.dev.vars.example` — copy it to `.dev.vars`, which is gitignored). Wrangler
loads `.dev.vars` automatically.

`vite dev` on its own still works for everything except cloud sync (it'll
fall back to localStorage and the footer will say the function couldn't be
reached).

## Build

```bash
npm run build
```

Outputs to `dist/`.

## Deploy to Cloudflare Pages

1. **Git-based deploy (recommended)** — push this folder to a GitHub/GitLab
   repo and connect it in the Cloudflare dashboard (Workers & Pages -> Create
   -> Pages -> Connect to Git). Set:
   - Build command: `npm run build`
   - Build output directory: `dist`

   Cloudflare automatically picks up the `functions/` directory and deploys
   `functions/api/baserow.js` as a Pages Function at `/api/baserow`.

2. **Wrangler CLI**
   ```bash
   npm install -g wrangler
   npm run build
   wrangler pages deploy dist
   ```

Then set the environment variables described below in the project's
**Settings -> Environment variables** (for both Production and Preview, if
you use both).

### Environment variables

Baserow credentials are **server-side environment variables**, never
entered in the browser or stored in `localStorage`. Set these in Cloudflare:

| Variable            | Required | Notes                                          |
| ------------------- | -------- | ----------------------------------------------- |
| `BASEROW_API_TOKEN`  | yes      | a Baserow database token (Settings -> Database tokens) |
| `BASEROW_TABLE_ID`   | yes      | the numeric table ID, visible in the table's API docs / URL |
| `BASEROW_API_URL`    | no       | defaults to `https://api.baserow.io`; override for a self-hosted Baserow instance |

The browser only ever sends `{action, sessionKey, value}` to `/api/baserow`;
the function reads the credentials from `env` (Cloudflare's binding, not
`process.env`) and does the real HTTPS call to Baserow server-side (see "Why
a function?" below). If the env vars aren't set, the function replies with
`{configured: false}` and the app transparently falls back to
`localStorage`.

### Why a function?

Baserow's API is meant to be called with a secret token — calling it
directly from browser JavaScript would expose that token to anyone who
opens devtools. Routing the call through a Cloudflare Pages Function
sidesteps that: the browser talks to your own domain, and the function
makes the real request to Baserow from Cloudflare's edge, where the token
stays server-side.

## Setting up Baserow as the database

The app emulates a simple key/value store on top of a normal Baserow table.

1. Create a database and table in Baserow (or use an existing one) with
   exactly two fields:
   - `SessionKey` — single line text
   - `Payload` — long text
2. Note the table's numeric ID — open the table and check the URL
   (`.../database/{database_id}/table/{table_id}/...`), or view the table's
   auto-generated API docs (`⋮` next to the table -> "View API docs"), which
   also show the ID directly.
3. Generate a Baserow **database token** in Account settings -> Database
   tokens, scoped to this database with create/read/update/delete
   permissions.
4. Set `BASEROW_API_TOKEN` and `BASEROW_TABLE_ID` (and `BASEROW_API_URL` if
   self-hosted) as environment variables on Cloudflare Pages (and/or in a
   local `.dev.vars` file for `wrangler pages dev`).
5. The app autosaves your workspace tabs to that table ~700ms after you stop
   typing, using one row keyed by a fixed session key. "Force Fetch from
   Cloud" pulls the latest saved row back down (handy for syncing across
   devices/browsers). If the env vars aren't set, the app transparently
   falls back to `localStorage` in the current browser.

## What changed from the original single-file version

- Split into a proper Vite/React project (`src/App.jsx`, `src/lib/*.js`)
  instead of one big HTML file with inline `<script>`.
- `functions/api/baserow.js` is a Cloudflare Pages Function that does the
  actual Baserow REST calls (row lookup by `SessionKey` via Baserow's
  `filter__SessionKey__equal` query param, then create/update/delete) —
  added so the API token never has to touch the browser.
- `src/lib/baserow.js` just posts `{action, sessionKey, value}` to
  `/api/baserow` and relays the response; it never talks to
  `api.baserow.io` itself.
- Credentials live only in Cloudflare's environment variables
  (`BASEROW_API_TOKEN`, `BASEROW_TABLE_ID`, optional `BASEROW_API_URL`),
  read via the Function's `env` binding — the app has no API-token input
  field and caches nothing credential-related in `localStorage`.
- All the JSON-wrangling logic (span detection, nested array discovery,
  keyword search, positional/keyword trimming, date-based sort) is
  unchanged in `src/lib/jsonTools.js`.

### Previously used Netlify + Stackby

Earlier versions of this project targeted Netlify Functions + Stackby.
That backend is fully replaced now: the Stackby REST calls (which required
a `{"records": [...]}` request body — an easy detail to get wrong, and the
original source of an `HTTP 400` bug in that version) are gone, along with
`netlify.toml` and `netlify/functions/`.
