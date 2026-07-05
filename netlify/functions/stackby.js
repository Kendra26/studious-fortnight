// Netlify Function: proxies Stackby REST calls server-side.
//
// The browser never talks to stackby.com directly (Stackby's API does not
// send back CORS headers, so a fetch() straight from the page fails with a
// CORS error, not a real auth/network error). Instead the frontend posts
// {action, sessionKey, value} to this function, which does the actual
// HTTPS call to Stackby from Netlify's servers and relays the result back.
//
// Credentials live ONLY in Netlify environment variables, never in the
// browser/localStorage:
//   STACKBY_API_KEY    (required)
//   STACKBY_STACK_ID   (required)
//   STACKBY_TABLE_NAME (optional, defaults to "AppSessions")
// Set these in Netlify: Site configuration -> Environment variables.
// Locally with `netlify dev`, put them in a .env file (already gitignored):
//   STACKBY_API_KEY=xxxxx
//   STACKBY_STACK_ID=xxxxx
//   STACKBY_TABLE_NAME=AppSessions

const STACKBY_BASE = 'https://stackby.com/api/betav1';
const DEFAULT_TABLE = 'AppSessions';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function authHeaders(apiKey) {
  return { 'api-key': apiKey, 'Content-Type': 'application/json' };
}

async function findRowIdByKey({ apiKey, stackId, tableName, sessionKey }) {
  const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stackby rowlist failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  const match = rows.find((r) => r.field && r.field.SessionKey === sessionKey);
  return match ? match.id : null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed, use POST.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const { action, sessionKey, value } = payload;

  const apiKey = process.env.STACKBY_API_KEY;
  const stackId = process.env.STACKBY_STACK_ID;
  const tableName = process.env.STACKBY_TABLE_NAME || DEFAULT_TABLE;

  // No server-side credentials configured yet -> tell the client so it can
  // fall back to local storage instead of throwing a scary error.
  if (!apiKey || !stackId) {
    return jsonResponse(200, { configured: false });
  }

  if (!sessionKey) {
    return jsonResponse(400, { error: 'Missing sessionKey.' });
  }

  try {
    if (action === 'get') {
      const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
      const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby fetch failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      const rows = await res.json();
      const match = Array.isArray(rows) ? rows.find((r) => r.field && r.field.SessionKey === sessionKey) : null;
      return jsonResponse(200, { configured: true, value: match ? match.field.Payload : null });
    }

    if (action === 'set') {
      if (typeof value !== 'string') return jsonResponse(400, { error: 'Missing value to store.' });
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
      const field = { SessionKey: sessionKey, Payload: value };

      if (existingId) {
        const res = await fetch(`${STACKBY_BASE}/rowupdate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'PATCH',
          headers: authHeaders(apiKey),
          body: JSON.stringify({ records: [{ id: existingId, field }] }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby update failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'updated' });
      } else {
        const res = await fetch(`${STACKBY_BASE}/rowcreate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'POST',
          headers: authHeaders(apiKey),
          body: JSON.stringify({ records: [{ field }] }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby create failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'created' });
      }
    }

    if (action === 'delete') {
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
      if (!existingId) return jsonResponse(200, { configured: true, deleted: false });
      const res = await fetch(`${STACKBY_BASE}/rowdelete/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ records: [existingId] }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby delete failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      return jsonResponse(200, { configured: true, deleted: true });
    }

    return jsonResponse(400, { error: `Unknown action "${action}".` });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Unexpected server error.' });
  }
};
