import { json } from './_lib.js';
export function onRequestPost() {
  return json({ ok: true }, 200, { 'set-cookie': 'battery_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0; Secure' });
}

