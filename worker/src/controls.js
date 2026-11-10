// Only documented P210 cloud controls are exposed. The device firmware may not
// reject an invalid write, so no caller can supply an arbitrary register.
const choices = {
  usbStandbyTime: [0, 3, 5, 10, 30],
  acStandbyTime: [0, 480, 960, 1440],
  dcStandbyTime: [0, 480, 960, 1440],
  screenRestTime: [0, 180, 300, 600, 1800],
  sleepTime: [5, 10, 30, 480],
};

export function resolveControl(setting, value, holding) {
  if (typeof setting !== 'string' || !Array.isArray(holding) || holding.length < 85) return null;
  const bool = typeof value === 'boolean' ? Number(value) : null;
  const integer = Number.isInteger(value) ? value : null;
  const switches = { usbOutput: 24, dcOutput: 25, acOutput: 26, buzzer: 56, silentCharging: 57 };
  if (Object.hasOwn(switches, setting)) return bool == null ? null : { register: switches[setting], value: bool };
  if (setting === 'ledMode') return integer != null && integer >= 0 && integer <= 3 ? { register: 27, value: integer } : null;
  const selects = { usbStandbyTime: 59, acStandbyTime: 60, dcStandbyTime: 61, screenRestTime: 62, sleepTime: 68 };
  if (Object.hasOwn(selects, setting)) return choices[setting].includes(value) ? { register: selects[setting], value } : null;
  if (setting === 'acChargingRate') return integer != null && integer >= 1 && integer <= 5 ? { register: 13, value: integer } : null;
  if (setting === 'dcInputType') return integer === 0 || integer === 1 ? { register: 15, value: integer } : null;
  if (setting === 'dcInputCurrent') {
    const maximum = holding[17] & 255;
    return integer != null && integer >= 1 && integer <= 20 && integer <= maximum ? { register: 20, value: integer } : null;
  }
  if (setting === 'dischargeLimit') return integer != null && integer >= 0 && integer <= 50 ? { register: 66, value: integer * 10 } : null;
  if (setting === 'chargeLimit') return integer != null && integer >= 60 && integer <= 100 ? { register: 67, value: integer * 10 } : null;
  return null;
}

export function plausibleSettings(holding) {
  return Array.isArray(holding) && holding.length >= 85
    && [24, 25, 26].every(index => [0, 1].includes(holding[index]))
    && [0, 1, 2, 3].includes(holding[27])
    && Number.isInteger(holding[66]) && holding[66] >= 0 && holding[66] <= 500
    && Number.isInteger(holding[67]) && holding[67] >= 600 && holding[67] <= 1000;
}
