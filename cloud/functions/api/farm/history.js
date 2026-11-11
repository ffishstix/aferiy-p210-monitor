import { json } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const hours = Math.min(720, Math.max(1, Number(new URL(request.url).searchParams.get('hours')) || 24));
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const bucketSeconds = Math.max(60, Math.ceil(hours * 3600 / 1500 / 60) * 60);
  const rows = await env.DB.prepare(`SELECT MIN(recorded_at) AS recorded_at, AVG(solar_w) AS solar_w, AVG(generator_w) AS generator_w, AVG(main_charge_percent) AS main_charge_percent, AVG(main_battery_w) AS main_battery_w, AVG(load_w) AS load_w FROM farm_telemetry WHERE recorded_at >= ? GROUP BY CAST(strftime('%s', recorded_at) AS INTEGER) / ? ORDER BY recorded_at ASC LIMIT 2000`).bind(since, bucketSeconds).all();
  return json({ hours, bucketSeconds, samples: rows.results });
}
