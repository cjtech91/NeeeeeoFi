function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function requireAuth(request, env) {
  const expected = env.API_TOKEN;
  if (!expected) return true;
  const auth = request.headers.get('Authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1] === expected;
  }
  return false;
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function importPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signToken(token, env) {
  const pem = env.LICENSE_PRIVATE_KEY_PEM;
  if (!pem) throw new Error('Missing LICENSE_PRIVATE_KEY_PEM');
  const key = await importPrivateKey(pem);
  const data = new TextEncoder().encode(JSON.stringify(token));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  return toBase64(sig);
}

function nowTs() {
  return Date.now();
}

async function getLicenseRow(env, key) {
  const r = await env.DB.prepare(
    'SELECT license_key, status, owner, type, expires_at, bound_serial FROM licenses WHERE license_key = ? LIMIT 1'
  ).bind(key).first();
  return r || null;
}

async function bindIfNeeded(env, key, systemSerial) {
  await env.DB.prepare(
    "UPDATE licenses SET bound_serial = ?, updated_at = ? WHERE license_key = ? AND (bound_serial IS NULL OR bound_serial = '')"
  ).bind(systemSerial, nowTs(), key).run();
}

function isExpired(row) {
  const exp = Number(row.expires_at || 0);
  return exp > 0 && exp < nowTs();
}

function buildToken(row, systemSerial, deviceModel) {
  return {
    type: row.type || 'PAID',
    owner: row.owner || 'Customer',
    expires: row.expires_at ? new Date(Number(row.expires_at)).toISOString() : 'Never',
    system_serial: systemSerial,
    System_Serial: systemSerial,
    device_model: deviceModel || null
  };
}

async function handleActivate(request, env) {
  if (!requireAuth(request, env)) return jsonResponse({ allowed: false, status: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || body.license_key || '').trim();
  const systemSerial = String(body.system_serial || body.System_Serial || body.hwid || body.serial || '').trim();
  const deviceModel = String(body.device_model || '').trim();
  if (!key || !systemSerial) return jsonResponse({ allowed: false, status: 'bad_request' }, 400);

  const row = await getLicenseRow(env, key);
  if (!row) return jsonResponse({ allowed: false, status: 'not_found' }, 404);
  if (String(row.status || '').toLowerCase() !== 'active') return jsonResponse({ allowed: false, status: 'revoked' }, 200);
  if (isExpired(row)) return jsonResponse({ allowed: false, status: 'expired' }, 200);

  const bound = String(row.bound_serial || '').trim();
  if (bound && bound !== systemSerial) {
    return jsonResponse({ allowed: false, status: 'bind_failed', message: 'Key is bound to another device' }, 200);
  }

  if (!bound) await bindIfNeeded(env, key, systemSerial);

  const token = buildToken(row, systemSerial, deviceModel);
  const signature = await signToken(token, env);
  return jsonResponse({ allowed: true, token, signature }, 200);
}

async function handleValidate(request, env) {
  if (!requireAuth(request, env)) return jsonResponse({ allowed: false, status: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || body.license_key || '').trim();
  const systemSerial = String(body.system_serial || body.System_Serial || body.hwid || body.serial || '').trim();
  const deviceModel = String(body.device_model || '').trim();
  if (!key || !systemSerial) return jsonResponse({ allowed: false, status: 'bad_request' }, 400);

  const row = await getLicenseRow(env, key);
  if (!row) return jsonResponse({ allowed: false, status: 'not_found' }, 404);
  if (String(row.status || '').toLowerCase() !== 'active') return jsonResponse({ allowed: false, status: 'revoked' }, 200);
  if (isExpired(row)) return jsonResponse({ allowed: false, status: 'expired' }, 200);

  const bound = String(row.bound_serial || '').trim();
  if (bound && bound !== systemSerial) {
    return jsonResponse({ allowed: false, status: 'serial_mismatch', message: 'Device mismatch' }, 200);
  }

  const token = buildToken(row, systemSerial, deviceModel);
  const signature = await signToken(token, env);
  return jsonResponse({ allowed: true, status: 'ok', token, signature }, 200);
}

async function handleHeartbeat(request, env) {
  if (!requireAuth(request, env)) return jsonResponse({ ok: false }, 401);
  const body = await request.json().catch(() => ({}));
  const systemSerial = String(body.system_serial || body.System_Serial || '').trim();
  if (!systemSerial) return jsonResponse({ ok: false }, 400);
  await env.DB.prepare(
    "INSERT INTO machines (system_serial, device_model, last_seen_at, metadata_json) VALUES (?, ?, ?, ?) ON CONFLICT(system_serial) DO UPDATE SET device_model=excluded.device_model, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json"
  ).bind(
    systemSerial,
    body.device_model || null,
    nowTs(),
    JSON.stringify(body.metadata || null)
  ).run();
  return jsonResponse({ ok: true }, 200);
}

async function getSubVendoRow(env, key) {
  const r = await env.DB.prepare(
    'SELECT license_key, status, hardware_id FROM sub_vendo_licenses WHERE license_key = ? LIMIT 1'
  ).bind(key).first();
  return r || null;
}

async function handleSubVendoClaim(request, env) {
  if (!requireAuth(request, env)) return jsonResponse({ allowed: false, status: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || body.license_key || '').trim();
  const hardwareId = String(body.hardware_id || body.device_id || '').trim();
  if (!key || !hardwareId) return jsonResponse({ allowed: false, status: 'bad_request' }, 400);

  const row = await getSubVendoRow(env, key);
  if (!row) return jsonResponse({ allowed: false, status: 'not_found', message: 'License key not found' }, 404);

  const status = String(row.status || 'unused').toLowerCase();
  if (status === 'revoked') return jsonResponse({ allowed: false, status: 'revoked', message: 'License key revoked' }, 200);

  const bound = String(row.hardware_id || '').trim();
  if (bound && bound !== hardwareId) {
    return jsonResponse({ allowed: false, status: 'bind_failed', message: 'License key already used by another device' }, 200);
  }

  if (!bound) {
    await env.DB.prepare(
      "UPDATE sub_vendo_licenses SET hardware_id = ?, status = 'active', activated_at = ?, updated_at = ? WHERE license_key = ?"
    ).bind(hardwareId, nowTs(), nowTs(), key).run();
  }

  return jsonResponse({ allowed: true, status: 'active' }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST') return jsonResponse({ error: 'Method Not Allowed' }, 405);
    if (url.pathname === '/activate') return handleActivate(request, env);
    if (url.pathname === '/validate-license') return handleValidate(request, env);
    if (url.pathname === '/heartbeat') return handleHeartbeat(request, env);
    if (url.pathname === '/subvendo/claim') return handleSubVendoClaim(request, env);
    return jsonResponse({ error: 'Not Found' }, 404);
  }
};
