import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePowerflow } from '../src/optics.js';

test('farm powerflow converts kW and does not treat absent FNDC charge as zero percent', () => {
  const sample = normalizePowerflow({
    isSystemOnline: true, isGeneratorRunning: false, isGridConnected: false,
    isFNDCPresent: false, batteryStateOfCharge: 0, batteryOutput: -0.2, batteryVoltage: 45.2,
    chargeControllerHoverDetails: [{ productionDetails: [{ output: { watts: 67 } }, { output: { watts: 72 } }] }],
    inverterHoverDetails: [{ inverterStatus: [{ inverterPowerFlowDetails: { load: 0.2, generator: 0 } }] }],
  });
  assert.equal(sample.solar_w, 139);
  assert.equal(sample.generator_running, 0);
  assert.equal(sample.generator_w, 0);
  assert.equal(sample.main_charge_percent, null);
  assert.equal(sample.main_battery_w, -200);
  assert.equal(sample.load_w, 200);
});

test('farm powerflow rejects offline and replayed data', () => {
  assert.throws(() => normalizePowerflow({ isSystemOnline: false }));
  assert.throws(() => normalizePowerflow({ isSystemOnline: true, isReplayOperationInProgress: true }));
});
