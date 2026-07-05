// Client-side helper for the Stackby-backed cloud sync.
//
// This does NOT call stackby.com directly — Stackby's API doesn't return
// CORS headers, so a browser fetch() to it fails before it even gets to
// check the API key. Instead every call goes to our own Netlify Function
// (netlify/functions/stackby.js), which makes the real request to Stackby
// server-side and hands the result back.
//
// Credentials (API key, Stack ID, table name) are never sent from the
// browser — they live only in Netlify environment variables and are read
// server-side inside the function. If they aren't set yet, the function
// replies with { configured: false } instead of a value, and the caller
// should fall back to local storage.

const FUNCTION_URL = '/.netlify/functions/stackby';

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
      'Could not reach the Netlify function. If you are running "vite dev" locally, use "netlify dev" instead so functions are served — plain Vite does not run them.'
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

export async function stackbySet({ sessionKey, value }) {
  return callFunction({ action: 'set', sessionKey, value });
}

export async function stackbyGet({ sessionKey }) {
  const data = await callFunction({ action: 'get', sessionKey });
  if (data.configured === false) return { configured: false, value: null };
  return { configured: true, value: data.value ?? null };
}

export async function stackbyDelete({ sessionKey }) {
  return callFunction({ action: 'delete', sessionKey });
}
