const API = 'https://opticsre.com/api';
let cachedToken;
let tokenUntil = 0;

async function post(path, body, token) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpticsRE ${path} HTTP ${response.status}`);
  const result = await response.json();
  if (result.statusCode !== 200 || !result.data) throw new Error(`OpticsRE ${path} returned no data`);
  return result.data;
}

async function token(env) {
  if (cachedToken && Date.now() < tokenUntil) return cachedToken;
  const data = await post('/accounts/login', { userName: env.OPTICS_USERNAME, password: env.OPTICS_PASSWORD, rememberMe: false });
  if (!data.token) throw new Error('OpticsRE login returned no token');
  cachedToken = data.token;
  tokenUntil = Date.now() + 10 * 60_000;
  return cachedToken;
}

function systemIds(env) {
  const systemId = Number(env.OPTICS_SYSTEM_ID), siteId = Number(env.OPTICS_SITE_ID), clientId = Number(env.OPTICS_CLIENT_ID);
  if (![systemId, siteId, clientId].every(Number.isSafeInteger)) throw new Error('OpticsRE system identifiers are not configured');
  return { systemId, siteId, clientId };
}

async function opticsRequest(env, path, body) {
  if (!env.OPTICS_USERNAME || !env.OPTICS_PASSWORD) throw new Error('OpticsRE credentials are not configured');
  try { return await post(path, body, await token(env)); }
  catch (error) {
    if (!String(error.message).includes('HTTP 401')) throw error;
    cachedToken = undefined;
    return await post(path, body, await token(env));
  }
}

export async function readOpticsControls(env) {
  const ids = systemIds(env);
  const [settings, buttons, registration] = await Promise.all([
    opticsRequest(env, '/legacy/device-settings', ids),
    opticsRequest(env, '/legacy/easy-buttons', ids),
    opticsRequest(env, '/legacy/device-registration', ids),
  ]);
  const editable = (settings.devices || []).map(device => ({
    model: device.modelNumber,
    port: device.portNumber,
    online: device.isOnline,
    tabs: (device.tabs || []).map(tab => ({
      name: tab.name,
      subsections: (tab.subsections || []).map(section => ({
        name: section.name,
        attributes: (section.attributes || []).filter(attribute => attribute.readOnly === false).map(attribute => ({
          key: attribute.dataFieldName,
          label: attribute.localizedAttributeName || attribute.dataFieldName,
          current: attribute.value?.current,
          options: attribute.value?.options || null,
          range: attribute.value?.range || null,
          unit: attribute.value?.unitOfMeasure || null,
        })),
      })).filter(section => section.attributes.length),
    })).filter(tab => tab.subsections.length),
  }));
  const easy = buttons.easyButtons || {};
  const quick = Object.fromEntries(['generator', 'inverter', 'acPower', 'battery'].map(key => [key, {
    status: easy[key]?.status,
    current: easy[key]?.current,
    options: easy[key]?.options || [],
    disabled: easy[key]?.isDisabled !== false,
  }]));
  const setup = registration.userHasFullControl ? [
    { key: 'name', label: 'System name', current: registration.name, type: 'text', category: 'system' },
    { key: 'batteryType', label: 'Battery type', current: registration.batteryType, options: ['Lithium Ion', 'Lead-acid'].map(text => ({ text })), category: 'battery' },
    { key: 'systemBatteryVoltage', label: 'Nominal battery voltage', current: String(registration.systemBatteryVoltage), options: [12, 24, 36, 48, 60].map(value => ({ text: String(value) })), unit: 'V', category: 'battery' },
    { key: 'batteryCapacity', label: 'Battery capacity', current: String(registration.batteryCapacity), range: { min: 25, max: 10000, increment: 1 }, unit: 'Ah', category: 'battery' },
    { key: 'batteryVoltageDropLimit', label: 'Low battery warning voltage', current: String(registration.batteryVoltageDropLimit), range: { min: 0, max: 60, increment: 0.1 }, unit: 'V', category: 'battery' },
    { key: 'pVArraySizeKW', label: 'Solar array size', current: String(registration.pvArraySizeKW), range: { min: 0, max: 50, increment: 0.1 }, unit: 'kW', category: 'solar' },
  ] : [];
  return { online: settings.isOnline === true, accessLevel: settings.siteAccessLevel, pending: settings.pendingPropertyInstructionCount || easy.pendingCommandsCount || 0, devices: editable, quick, setup, readAt: new Date().toISOString() };
}

export async function changeOpticsControl(env, command) {
  const ids = systemIds(env);
  if (!command || typeof command !== 'object' || typeof command.expectedCurrent !== 'string') throw new Error('Invalid OpticsRE change');
  if (command.kind === 'system') {
    const allowed = ['name', 'batteryType', 'systemBatteryVoltage', 'batteryCapacity', 'batteryVoltageDropLimit', 'pVArraySizeKW'];
    if (!allowed.includes(command.key) || typeof command.value !== 'string' || command.value.length > 100) throw new Error('Invalid system setting');
    const registration = await opticsRequest(env, '/legacy/device-registration', ids);
    if (!registration.isOnline || !registration.userHasFullControl) throw new Error('System setup is unavailable');
    const source = command.key === 'pVArraySizeKW' ? registration.pvArraySizeKW : registration[command.key];
    if (String(source) !== command.expectedCurrent) throw new Error('System setup changed since it was loaded; refresh first');
    let value = command.value;
    if (command.key === 'name') {
      if (!value.trim() || value.length > 80) throw new Error('Invalid system name');
    } else if (command.key === 'batteryType') {
      if (!['Lithium Ion', 'Lead-acid'].includes(value)) throw new Error('Invalid battery type');
    } else {
      value = Number(value);
      const ranges = { batteryCapacity: [25, 10000], batteryVoltageDropLimit: [0, 60], pVArraySizeKW: [0, 50] };
      if (command.key === 'systemBatteryVoltage' ? ![12, 24, 36, 48, 60].includes(value) : !Number.isFinite(value) || value < ranges[command.key][0] || value > ranges[command.key][1]) throw new Error('Value is outside the allowed range');
    }
    if (String(value) === command.expectedCurrent) throw new Error('System setup already has that value');
    const updated = { ...registration, [command.key === 'name' ? 'name' : command.key === 'pVArraySizeKW' ? 'pvArraySizeKW' : command.key]: value };
    const payload = { systemId: ids.systemId, siteId: ids.siteId, systemName: updated.name, macAddress: updated.macAddress, batteryType: updated.batteryType, systemBatteryVoltage: updated.systemBatteryVoltage, pVArraySizeKW: updated.pvArraySizeKW, batteryVoltageDropLimit: updated.batteryVoltageDropLimit, batteryCapacity: updated.batteryCapacity, rowVersion: updated.rowVersion,
      devices: (updated.devices || []).map(device => ({ portNumber: device.portNumber, deviceName: device.portNumber === 65535 ? '' : device.deviceName || '', modelNumber: device.modelNumber || '', oldModelNumber: device.oldModelNumber || '', isModelNumberExists: device.isModelNumberExists, isRegistered: device.isRegistered, serialNumber: device.serialNumber || '' })) };
    const result = await opticsRequest(env, '/legacy/update-system-device-registration', payload);
    if (result.success !== true) throw new Error('OpticsRE did not confirm the system setup update');
    return { accepted: true, pending: 0, message: 'OpticsRE accepted the system setup update. Refresh to verify the saved value.' };
  }
  if (command.kind === 'setting') {
    if (!Number.isSafeInteger(command.port) || typeof command.key !== 'string' || command.key.length > 100 || typeof command.value !== 'string' || command.value.length > 100) throw new Error('Invalid OpticsRE setting');
    const settings = await opticsRequest(env, '/legacy/device-settings', ids);
    if (!settings.isOnline || settings.pendingPropertyInstructionCount > 0) throw new Error('Farm system is offline or another change is pending');
    const device = (settings.devices || []).find(item => item.portNumber === command.port);
    if (!device?.isOnline) throw new Error('Device is offline');
    const matches = (device.tabs || []).flatMap(tab => tab.subsections || []).flatMap(section => section.attributes || []).filter(attribute => attribute.dataFieldName === command.key);
    if (matches.length !== 1 || matches[0].readOnly !== false) throw new Error('Setting is unavailable');
    const attribute = matches[0];
    if (String(attribute.value?.current) !== command.expectedCurrent) throw new Error('Setting changed since it was loaded; refresh first');
    if (attribute.value.options?.length) {
      if (!attribute.value.options.some(option => option.text === command.value)) throw new Error('Value is not an available choice');
    } else if (attribute.value.range) {
      const { min, max, increment } = attribute.value.range;
      const value = Number(command.value);
      if (!Number.isFinite(value) || value < min || value > max || (increment > 0 && Math.abs((value - min) / increment - Math.round((value - min) / increment)) > 0.00001)) throw new Error('Value is outside the allowed range');
    } else throw new Error('Setting has no supported editor');
    if (command.value === command.expectedCurrent) throw new Error('Setting already has that value');
    attribute.value.current = command.value;
    const result = await opticsRequest(env, '/legacy/apply-device-settings', { device, ...ids, macAddress: settings.macAddress, resetFactoryDefaultsOperation: false });
    return { accepted: true, pending: result.commandResponseModel?.pendingCommandCount ?? null, message: 'OpticsRE accepted the change. Refresh later to verify the device value.' };
  }
  if (command.kind === 'quick') {
    if (!['generator', 'inverter', 'acPower', 'battery'].includes(command.key) || !Number.isInteger(command.value)) throw new Error('Invalid OpticsRE control');
    const [settings, buttons] = await Promise.all([opticsRequest(env, '/legacy/device-settings', ids), opticsRequest(env, '/legacy/easy-buttons', ids)]);
    const easy = buttons.easyButtons;
    if (!settings.isOnline || settings.pendingPropertyInstructionCount > 0 || easy?.pendingCommandsCount > 0) throw new Error('Farm system is offline or another change is pending');
    const target = easy?.[command.key];
    if (!target || target.isDisabled !== false || String(target.current) !== command.expectedCurrent) throw new Error('Control changed or is unavailable; refresh first');
    if (!target.options?.some(option => option.value === command.value && option.isDisabled === false)) throw new Error('Control value is unavailable');
    if (target.current === command.value) throw new Error('Control already has that value');
    target.current = command.value;
    const result = await opticsRequest(env, '/legacy/apply-easy-buttons', { acPower: easy.acPower, battery: easy.battery, generator: easy.generator, inverter: easy.inverter, legacyEasyButtonDevices: easy.connectedDevices, siteId: ids.siteId, macAddress: settings.macAddress });
    return { accepted: true, pending: result.commandResponseModel?.pendingCommandCount ?? null, message: 'OpticsRE accepted the control request. Refresh later to verify its state.' };
  }
  throw new Error('Unknown OpticsRE control');
}

const watts = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : null;

export function normalizePowerflow(flow, recordedAt = new Date().toISOString()) {
  if (!flow || flow.isSystemOnline !== true || flow.isReplayOperationInProgress === true) throw new Error('OutBack system is offline or replaying old data');
  const controllers = flow.chargeControllerHoverDetails?.flatMap(item => item.productionDetails || []) || [];
  const solarValues = controllers.map(item => item.output?.watts).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const solarW = solarValues.length ? Math.round(solarValues.reduce((a, b) => a + b, 0)) : watts(flow.solarToBattery);
  const inverters = flow.inverterHoverDetails?.flatMap(item => item.inverterStatus || []) || [];
  const generatorToLoads = inverters.map(item => item.inverterPowerFlowDetails?.generator).filter(value => typeof value === 'number' && Number.isFinite(value));
  const loadValues = inverters.map(item => item.inverterPowerFlowDetails?.load).filter(value => typeof value === 'number' && Number.isFinite(value));
  const generatorW = flow.isGeneratorRunning === false ? 0 : generatorToLoads.length || Number.isFinite(flow.generatorToBattery) ? watts(generatorToLoads.reduce((a, b) => a + b, 0) + (Number(flow.generatorToBattery) || 0)) : null;
  const charge = flow.isFNDCPresent && Number.isFinite(flow.batteryStateOfCharge) && flow.batteryStateOfCharge >= 0 && flow.batteryStateOfCharge <= 100 ? flow.batteryStateOfCharge : null;
  return {
    recorded_at: recordedAt,
    solar_w: solarW,
    generator_w: generatorW,
    generator_running: flow.isGeneratorRunning == null ? null : Number(flow.isGeneratorRunning),
    ac_source: flow.isGeneratorRunning ? 'generator' : flow.isGridConnected ? 'grid' : 'none',
    main_charge_percent: charge,
    // OpticsRE reports negative batteryOutput while the bank is supplying loads.
    main_battery_w: watts(flow.batteryOutput),
    main_battery_v: Number.isFinite(flow.batteryVoltage) ? flow.batteryVoltage : null,
    load_w: loadValues.length ? watts(loadValues.reduce((a, b) => a + b, 0)) : null,
  };
}

export async function collectFarm(env) {
  if (!env.OPTICS_USERNAME || !env.OPTICS_PASSWORD) throw new Error('OpticsRE credentials are not configured');
  const id = Number(env.OPTICS_SYSTEM_ID);
  const site = Number(env.OPTICS_SITE_ID);
  const client = Number(env.OPTICS_CLIENT_ID);
  if (![id, site, client].every(Number.isSafeInteger)) throw new Error('OpticsRE system identifiers are not configured');
  let auth = await token(env);
  const body = { type: 'system', id, siteId: site, clientId: client };
  let data;
  try { data = await post('/legacy/energy-flow', body, auth); }
  catch (error) {
    if (!String(error.message).includes('HTTP 401')) throw error;
    cachedToken = undefined;
    auth = await token(env);
    data = await post('/legacy/energy-flow', body, auth);
  }
  const sample = normalizePowerflow(data.powerflow);
  await env.DB.prepare(`INSERT INTO farm_telemetry (source_id,sample_id,recorded_at,solar_w,generator_w,generator_running,ac_source,main_charge_percent,main_battery_w,main_battery_v,load_w) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    `optics-${id}`, crypto.randomUUID(), sample.recorded_at, sample.solar_w, sample.generator_w, sample.generator_running, sample.ac_source, sample.main_charge_percent, sample.main_battery_w, sample.main_battery_v, sample.load_w).run();
  return { recordedAt: sample.recorded_at, solarW: sample.solar_w };
}
