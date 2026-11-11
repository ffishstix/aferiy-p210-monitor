import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as status } from '../functions/api/farm/status.js';
import { onRequestGet as history } from '../functions/api/farm/history.js';

test('farm status exposes only normalized readings and marks old readings stale', async () => {
  let query;
  const sample = { recorded_at: new Date(Date.now() - 180000).toISOString(), solar_w: 139, generator_running: 0, main_battery_w: -200 };
  const env = { DB: { prepare(sql) { query = sql; return { first: async () => sample }; } } };
  const result = await (await status({ env })).json();
  assert.equal(result.status, 'stale');
  assert.equal(result.sample.solar_w, 139);
  assert.doesNotMatch(query, /raw_json|macAddress|SELECT \*/);
});

test('farm history has bounded buckets', async () => {
  let bind;
  const env = { DB: { prepare() { return { bind(...args) { bind = args; return { all: async () => ({ results: [] }) }; } }; } } };
  const result = await (await history({ request: new Request('https://example.com/api/farm/history?hours=720'), env })).json();
  assert.equal(result.bucketSeconds, 1740);
  assert.equal(bind[1], 1740);
});
