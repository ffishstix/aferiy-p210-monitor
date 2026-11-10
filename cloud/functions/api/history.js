import { authorised, json } from './_lib.js';
export async function onRequestGet({ request, env }) {
  if (!await authorised(request, env)) return json({ error: 'Sign in required' }, 401);
  const url = new URL(request.url);
  const hours = Math.min(720, Math.max(1, Number(url.searchParams.get('hours')) || 24));
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = await env.DB.prepare('SELECT recorded_at, received_at, charge_percent, input_w, output_w, remaining_minutes, grid_present, discharging, fault FROM telemetry WHERE recorded_at >= ? ORDER BY recorded_at DESC LIMIT 2000').bind(since).all();
  return json({ hours, samples: rows.results.reverse() });
}

