import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, authorised, statusOf } from '../functions/api/_lib.js';
import { onRequestPost as ingest } from '../functions/api/ingest.js';

test('session authenticates and rejects tampering', async () => {
  const secret = 'test-session-secret';
  const session = await makeSession(secret);
  const request = new Request('https://example.com/api/status', { headers: { cookie: `battery_session=${session}` } });
  assert.equal(await authorised(request, { SESSION_SECRET: secret }), true);
  const tampered = new Request('https://example.com/api/status', { headers: { cookie: `battery_session=${session.slice(0, -1)}${session.at(-1) === '0' ? '1' : '0'}` } });
  assert.equal(await authorised(tampered, { SESSION_SECRET: secret }), false);
});

test('old readings are stale and outage readings are discharging', () => {
  assert.equal(statusOf({ received_at: new Date(Date.now() - 180000).toISOString(), discharging: 1, grid_present: 0 }), 'stale');
  assert.equal(statusOf({ received_at: new Date().toISOString(), discharging: 1, grid_present: 0 }), 'discharging');
});

test('ingest requires a secret and validates values before writing', async () => {
  let wrote = false;
  const env = { INGEST_SECRET: 'private-test-key', DB: { prepare() { throw new Error('Should not write'); }, batch() { wrote = true; } } };
  const body = { device_id: 'P210', samples: [{ sample_id: '1', recorded_at: new Date().toISOString(), charge_percent: 150 }] };
  const unauthorized = await ingest({ request: new Request('https://example.com/api/ingest', { method: 'POST', body: JSON.stringify(body) }), env });
  assert.equal(unauthorized.status, 401);
  const invalid = await ingest({ request: new Request('https://example.com/api/ingest', { method: 'POST', headers: { authorization: 'Bearer private-test-key' }, body: JSON.stringify(body) }), env });
  assert.equal(invalid.status, 400);
  assert.equal(wrote, false);
});
