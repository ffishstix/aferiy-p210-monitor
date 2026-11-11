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
