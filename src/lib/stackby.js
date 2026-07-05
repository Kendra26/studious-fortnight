// Thin client for Stackby's REST API (https://stackby.com/api/betav1).
//
// Stackby has no native key/value "SET"/"GET" the way Upstash does, so this
// module emulates one: a single table with two columns —
//   "SessionKey"  (text, unique per browser/session slot)
//   "Payload"     (long text, holds the JSON-stringified app state)
//
// A row is looked up by SessionKey; if it exists it's patched, otherwise a
// new row is created. This mirrors the SET/GET/DEL calls the app used to
// make against Upstash.

const BASE = 'https://stackby.com/api/betav1';

function authHeaders(apiKey) {
  return {
    'api-key': apiKey,
    'Content-Type': 'application/json',
  };
}

function tableUrl(stackId, tableName) {
  return `${BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
}

async function findRowIdByKey({ apiKey, stackId, tableName, sessionKey }) {
  const res = await fetch(tableUrl(stackId, tableName), {
    method: 'GET',
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`Stackby list failed (HTTP ${res.status})`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  const match = rows.find(
    (r) => r.field && r.field.SessionKey === sessionKey
  );
  return match ? match.id : null;
}

export async function stackbySet({ apiKey, stackId, tableName, sessionKey, value }) {
  const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
  const payload = { field: { SessionKey: sessionKey, Payload: value } };

  if (existingId) {
    const res = await fetch(`${BASE}/rowupdate/${stackId}/${encodeURIComponent(tableName)}`, {
      method: 'PATCH',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ rows: [{ id: existingId, ...payload }] }),
    });
    if (!res.ok) throw new Error(`Stackby update failed (HTTP ${res.status})`);
    return res.json();
  } else {
    const res = await fetch(`${BASE}/rowcreate/${stackId}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ rows: [payload] }),
    });
    if (!res.ok) throw new Error(`Stackby create failed (HTTP ${res.status})`);
    return res.json();
  }
}

export async function stackbyGet({ apiKey, stackId, tableName, sessionKey }) {
  const res = await fetch(tableUrl(stackId, tableName), {
    method: 'GET',
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`Stackby fetch failed (HTTP ${res.status})`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  const match = rows.find((r) => r.field && r.field.SessionKey === sessionKey);
  return match ? match.field.Payload : null;
}

export async function stackbyDelete({ apiKey, stackId, tableName, sessionKey }) {
  const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
  if (!existingId) return { deleted: false };
  const res = await fetch(`${BASE}/rowdelete/${stackId}/${encodeURIComponent(tableName)}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ rowIds: [existingId] }),
  });
  if (!res.ok) throw new Error(`Stackby delete failed (HTTP ${res.status})`);
  return { deleted: true };
}
