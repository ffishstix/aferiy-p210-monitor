const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))), b => b.toString(16).padStart(2, '0')).join('');
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function makeSession(secret) {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function authorised(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('battery_session='))?.slice('battery_session='.length);
  if (!value) return false;
  const [expires, signature] = value.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return equal(signature, await hmac(expires, env.SESSION_SECRET));
}

export function sessionCookie(value, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `battery_session=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800${secure}`;
}

export function validNumber(value, min, max) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

export function statusOf(sample) {
  if (!sample) return 'no_data';
  if (Date.now() - Date.parse(sample.received_at) > 120000) return 'stale';
  if (sample.fault === 1) return 'fault';
  if (sample.discharging === 1 && sample.grid_present !== 1) return 'discharging';
  if (sample.grid_present === 1 && sample.output_w > 0 && Math.abs(sample.input_w - sample.output_w) <= 25) return 'passthrough';
  if (sample.input_w > sample.output_w + 25) return 'charging';
  return 'idle';
}

export async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) throw new Error('Payload too large');
  const text = await request.text();
  if (text.length > 32768) throw new Error('Payload too large');
  return JSON.parse(text);
}

