import { json, statusOf } from './_lib.js';
export async function onRequestGet({ env }) {
  const sample = await env.DB.prepare(`SELECT recorded_at, received_at, charge_percent, input_w, output_w,
    ac_input_w, dc_input_w, remaining_minutes, grid_present, discharging, fault
    FROM telemetry ORDER BY received_at DESC, id DESC LIMIT 1`).first();
  return json({ sample, status: statusOf(sample) });
}

