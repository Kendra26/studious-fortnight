// Client-side helper for the Baserow-backed cloud sync.
//
// This does NOT call api.baserow.io directly from the browser — the API
// token would be exposed to anyone opening devtools. Instead every call
// goes to our own Cloudflare Pages Function (functions/api/baserow.js,
// served at /api/baserow), which makes the real request to Baserow
// server-side and hands the result back.
//
// Credentials (API token, table ID) are never sent from the browser — they
// live only in Cloudflare's environment variables and are read server-side
// inside the function. If they aren't set yet, the function replies with
// { configured: false } instead of a value, and the caller falls back to
// local storage.

const FUNCTION_URL = '/api/baserow';

async function callFunction(body) {
  let res;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      'Could not reach the Pages Function. If you are running "vite dev" locally, use "wrangler pages dev -- npm run dev" (or build + "wrangler pages dev dist") instead — plain Vite does not run Functions.'
    );
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Function returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

export async function baserowSet({ sessionKey, value }) {
  return callFunction({ action: 'set', sessionKey, value });
}

export async function baserowGet({ sessionKey }) {
  const data = await callFunction({ action: 'get', sessionKey });
  if (data.configured === false) return { configured: false, value: null };
  return { configured: true, value: data.value ?? null };
}

export async function baserowDelete({ sessionKey }) {
  return callFunction({ action: 'delete', sessionKey });
}
