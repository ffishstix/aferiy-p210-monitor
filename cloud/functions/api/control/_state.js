const word = (registers, index) => Number.isInteger(registers?.[index]) && registers[index] >= 0 && registers[index] <= 65535 ? registers[index] : null;
const low = value => value == null ? null : value & 255;
const bit = (value, index) => value == null ? null : Boolean(value & (1 << index));

export function controlState(sample) {
  if (!sample) return { available: false, reason: 'Waiting for a device reading', settings: null };
  let raw;
  try { raw = JSON.parse(sample.raw_json); } catch { raw = null; }
  const holding = Array.isArray(raw?.holdingRegisters) ? raw.holdingRegisters : null;
  const input = Array.isArray(raw?.inputRegisters) ? raw.inputRegisters : null;
  const protocolVersion = word(holding, 5);
  const model = word(holding, 11);
  const highState = word(input, 41);
  const lowState = word(input, 42);
  const light = low(word(input, 25));
  const fresh = Number.isFinite(Date.parse(sample.received_at)) && Date.now() - Date.parse(sample.received_at) <= 120000;
  const v0 = protocolVersion != null && [0, 1].includes(protocolVersion & 15);
  const complete = holding?.length >= 71 && input?.length >= 60;
  const available = Boolean(fresh && v0 && complete && model && highState != null && lowState != null);
  const reason = !fresh ? 'The last device reading is stale' : !complete ? 'Settings registers are unavailable' : !v0 ? 'Device protocol is not confirmed' : !model ? 'Device model is unavailable' : highState == null || lowState == null ? 'Output state is unavailable' : null;
  const lowBattery = word(holding, 69);
  return {
    available,
    reason,
    receivedAt: sample.received_at,
    diagnostic: { protocolVersion: protocolVersion == null ? null : protocolVersion & 15, modelCode: low(model), holdingCount: holding?.length ?? 0, inputCount: input?.length ?? 0 },
    settings: complete ? {
      usbOutput: bit(highState, 9), dcOutput: bit(highState, 10), acOutput: bit(highState, 11),
      ledMode: light != null && light <= 3 ? light : null,
      acChargingRate: word(holding, 13), dcInputType: low(word(holding, 15)),
      dcInputMaxCurrent: low(word(holding, 17)), dcInputCurrent: low(word(holding, 20)),
      buzzer: low(word(holding, 56)) === 1, silentCharging: low(word(holding, 57)) === 1,
      usbStandbyTime: word(holding, 59), acStandbyTime: word(holding, 60), dcStandbyTime: word(holding, 61),
      screenRestTime: word(holding, 62), stopChargeAfter: word(holding, 63),
      dischargeLimit: word(holding, 66) == null ? null : word(holding, 66) / 10,
      chargeLimit: word(holding, 67) == null ? null : word(holding, 67) / 10,
      sleepTime: word(holding, 68), lowBatteryNotify: lowBattery == null ? null : (lowBattery >> 8) === 1,
      lowBatteryThreshold: low(lowBattery), gridAcAutoOutput: word(holding, 70) === 1,
    } : null,
  };
}
