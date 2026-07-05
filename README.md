# json/extract

A React + Vite port of the JSON extract/trim tool, deployable to Netlify.
Cloud sync now uses **Stackby** instead of Upstash.

## Run locally

```bash
npm install
npm run dev
```

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

No environment variables are required at build time — the Stackby
credentials are entered by the user at runtime in the app's own "Stackby
Cloud Storage Setup" panel and stored only in that browser's `localStorage`,
and are sent directly from the browser to the Stackby API.

## Setting up Stackby as the database

The app emulates a simple key/value store on top of a normal Stackby table
(Stackby itself is a spreadsheet-style database, so this is the closest
analog to Upstash's `SET`/`GET`).

1. Create a Stack in Stackby (or use an existing one) and note its **Stack
   ID** — it's the string in the Stackby URL right after `/`, e.g.
   `stackby.com/{stackId}/...`.
2. Inside that stack, create a table (default name expected: `AppSessions`,
   but you can call it anything and enter it in the app) with exactly two
   columns:
   - `SessionKey` — single line text
   - `Payload` — long text
3. Generate a Stackby **API key** from your account settings.
4. In the app's "Stackby Cloud Storage Setup" panel, paste in:
   - API Key
   - Stack ID
   - Table name (matching what you created)
5. The app autosaves your workspace tabs to that table ~700ms after you stop
   typing, using one row keyed by a fixed session key. "Force Fetch from
   Cloud" pulls the latest saved row back down (handy for syncing across
   devices/browsers). If Stackby isn't configured, the app transparently
   falls back to `localStorage` in the current browser.

## What changed from the original single-file version

- Split into a proper Vite/React project (`src/App.jsx`, `src/lib/*.js`)
  instead of one big HTML file with inline `<script>`.
- `src/lib/stackby.js` replaces the old Upstash REST helper — it does a
  row lookup by `SessionKey` and PATCHes/POSTs to Stackby's
  `rowupdate`/`rowcreate` endpoints instead of issuing Upstash's raw
  `SET`/`GET`/`DEL` commands.
- Removed the placeholder hardcoded credential constants from the original
  file — credentials are only ever the ones you type into the setup panel.
- All the JSON-wrangling logic (span detection, nested array discovery,
  keyword search, positional/keyword trimming, date-based sort) is ported
  as-is into `src/lib/jsonTools.js`.
