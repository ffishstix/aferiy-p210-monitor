import { authorised, json, statusOf } from './_lib.js';
export async function onRequestGet({ request, env }) {
  if (!await authorised(request, env)) return json({ error: 'Sign in required' }, 401);
  const sample = await env.DB.prepare('SELECT * FROM telemetry ORDER BY received_at DESC, id DESC LIMIT 1').first();
  return json({ sample, status: statusOf(sample) });
}

