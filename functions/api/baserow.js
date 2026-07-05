// Cloudflare Pages Function: proxies Baserow REST calls server-side.
//
// The browser never talks to Baserow directly, and it never sees the API
// token. The frontend posts {action, sessionKey, value} to this function
// (served at /api/baserow because this file is functions/api/baserow.js),
// which does the real HTTPS call to Baserow using credentials pulled from
// Cloudflare's environment variables, then relays the result back.
//
// Required environment variables (set in the Cloudflare dashboard under
// Workers & Pages -> your project -> Settings -> Environment variables,
// or in a local .dev.vars file for `wrangler pages dev`):
//   BASEROW_API_TOKEN  (required) - a Baserow database token
//   BASEROW_TABLE_ID   (required) - the numeric table ID
//   BASEROW_API_URL    (optional) - defaults to https://api.baserow.io,
//                                    override for a self-hosted instance
//
// Expected table schema (two fields):
//   SessionKey - single line text
//   Payload    - long text

const DEFAULT_BASE = 'https://api.baserow.io';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authHeaders(token) {
  return { Authorization: `Token ${token}`, 'Content-Type': 'application/json' };
}

async function findRowByKey({ base, token, tableId, sessionKey }) {
  const url = `${base}/api/database/rows/table/${encodeURIComponent(tableId)}/?user_field_names=true&filter__SessionKey__equal=${encodeURIComponent(sessionKey)}`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(token) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Baserow list failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data.results) ? data.results : [];
  return rows.length > 0 ? rows[0] : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const { action, sessionKey, value } = payload;

  const token = env.BASEROW_API_TOKEN;
  const tableId = env.BASEROW_TABLE_ID;
  const base = (env.BASEROW_API_URL || DEFAULT_BASE).replace(/\/$/, '');

  // No server-side credentials configured yet -> tell the client so it can
  // fall back to local storage instead of throwing a scary error.
  if (!token || !tableId) {
    return jsonResponse(200, { configured: false });
  }

  if (!sessionKey) {
    return jsonResponse(400, { error: 'Missing sessionKey.' });
  }

  try {
    if (action === 'get') {
      const row = await findRowByKey({ base, token, tableId, sessionKey });
      return jsonResponse(200, { configured: true, value: row ? row.Payload : null });
    }

    if (action === 'set') {
      if (typeof value !== 'string') return jsonResponse(400, { error: 'Missing value to store.' });
      const existing = await findRowByKey({ base, token, tableId, sessionKey });

      if (existing) {
        const url = `${base}/api/database/rows/table/${encodeURIComponent(tableId)}/${existing.id}/?user_field_names=true`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ Payload: value }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Baserow update failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'updated' });
      } else {
        const url = `${base}/api/database/rows/table/${encodeURIComponent(tableId)}/?user_field_names=true`;
        const res = await fetch(url, {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ SessionKey: sessionKey, Payload: value }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Baserow create failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'created' });
      }
    }

    if (action === 'delete') {
      const existing = await findRowByKey({ base, token, tableId, sessionKey });
      if (!existing) return jsonResponse(200, { configured: true, deleted: false });
      const url = `${base}/api/database/rows/table/${encodeURIComponent(tableId)}/${existing.id}/`;
      const res = await fetch(url, { method: 'DELETE', headers: authHeaders(token) });
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Baserow delete failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      return jsonResponse(200, { configured: true, deleted: true });
    }

    return jsonResponse(400, { error: `Unknown action "${action}".` });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Unexpected server error.' });
  }
}

export async function onRequestGet() {
  return jsonResponse(405, { error: 'Method not allowed, use POST.' });
}
