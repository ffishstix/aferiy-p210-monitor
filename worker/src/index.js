import { connectPacket, decodeModbus, md5, parsePacket, publishPacket, readRequest, signature, subscribePacket } from './protocol.js';

// BrightEMS cloud protocol, based on the community Fossibot Home Assistant integration.
const API_URL = 'https://api.next.bspapp.com/client';
const SPACE_ID = 'mp-6c382a98-49b8-40ba-b761-645d83e8ee74';
const CLIENT_SECRET = '5rCEdl/nx7IgViBe4QYRiQ==';
const CLIENT_INFO = { PLATFORM:'app', OS:'android', APPID:'__UNI__55F5E7F', DEVICEID:'621DF9EDD14684453E5099DCF6B8D26B', channel:'google', scene:1001, uniPlatform:'app', browserName:'chrome', deviceBrand:'google', appId:'__UNI__55F5E7F', appWgtVersion:'1.5.9', osVersion:'16', romName:'Android', deviceModel:'sdk_gphone64_arm64', browserVersion:'145.0.7632.120', deviceType:'phone', deviceId:'621DF9EDD14684453E5099DCF6B8D26B', ua:'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64)', appName:'BrightEMS', uniRuntimeVersion:'5.01', romVersion:'16', appVersion:'1.5.9', appVersionCode:159, appLanguage:'en', uniCompilerVersion:'5.01', locale:'en', LOCALE:'en' };

async function apiRequest(method, params, token) {
  const body = { method, params, spaceId:SPACE_ID, timestamp:Date.now() };
  if (token) body.token = token;
  const response = await fetch(API_URL, { method:'POST', headers:{ 'content-type':'application/json', 'user-agent':'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64)', 'x-serverless-sign':signature(body, CLIENT_SECRET), ...(token ? {'x-basement-token':token} : {}) }, body:JSON.stringify(body) });
  if (!response.ok) throw new Error(`BrightEMS HTTP ${response.status}`);
  const result = await response.json();
  if (!result || typeof result !== 'object') throw new Error('Invalid BrightEMS response');
  return result;
}
async function invoke(path, data, accessToken, uniIdToken) {
  const params = JSON.stringify({ functionTarget:'router', functionArgs:{ $url:path, data:{locale:'en', ...data}, clientInfo:CLIENT_INFO, ...(uniIdToken ? {uniIdToken} : {}) } });
  const result = await apiRequest('serverless.function.runtime.invoke', params, accessToken);
  if (result.data?.errCode || result.data?.errMsg && !result.data?.token && !result.data?.rows && !result.data?.access_token) throw new Error(`BrightEMS ${path}: ${result.data.errMsg || result.data.errCode}`);
  return result.data || {};
}
async function credentials(env) {
  const anonymous = await apiRequest('serverless.auth.user.anonymousAuthorize', '{}');
  const access = anonymous.data?.accessToken;
  if (!access) throw new Error('BrightEMS anonymous authorization failed');
  const login = await invoke('user/pub/login', {username:env.BRIGHTEMS_USERNAME, password:env.BRIGHTEMS_PASSWORD}, access);
  if (!login.token || !login.userInfo?._id) throw new Error('BrightEMS login failed');
  const list = await invoke('client/device/kh/getList_v2', {pageIndex:1,pageSize:10,isForce:true}, access, login.token);
  const devices = list.rows || [];
  const device = env.BRIGHTEMS_DEVICE_ID ? devices.find(d => d.device_id === env.BRIGHTEMS_DEVICE_ID) : devices.length === 1 ? devices[0] : null;
  if (!device?.device_id) throw new Error(`Device selection failed (${devices.length} devices; set BRIGHTEMS_DEVICE_ID if needed)`);
  const timestamp = Date.now(), userId = login.userInfo._id;
  const hash = md5(`timestamp=${timestamp}&api_secret=${userId.slice(timestamp % 10)}`);
  const mqtt = await invoke('common/emqx.getAccessToken2', {sign:hash,timestamp,timezoneOffset:0,device_id:device.device_id}, access, login.token);
  if (!mqtt.access_token) throw new Error('BrightEMS MQTT access token unavailable');
  return { device, userId, mqtt };
}
function waitForReading(ws, deviceId, address, count) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT reading timed out')), 12000);
    let subscribed = false;
    const finish = (error, result) => { clearTimeout(timer); ws.removeEventListener('message', onMessage); ws.removeEventListener('close', onClose); ws.removeEventListener('error', onError); error ? reject(error) : resolve(result); };
    const onClose = () => finish(new Error('MQTT closed before reading'));
    const onError = () => finish(new Error('MQTT socket error'));
    const onMessage = event => {
      try {
        const packet = parsePacket(event.data);
        if (packet.type === 2) {
          if (packet.payload[1] !== 0) return finish(new Error(`MQTT authentication rejected (${packet.payload[1]})`));
          ws.send(subscribePacket(deviceId));
        } else if (packet.type === 9 && !subscribed) {
          subscribed = true;
          ws.send(publishPacket(`${deviceId}/client/request/data`, readRequest(address, 4, count)));
        } else if (packet.type === 3 && packet.topic?.includes('/device/response/client/')) {
          const reading = decodeModbus(packet.payload);
          if (reading) finish(null, reading);
        }
      } catch (error) { finish(error); }
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  });
}
async function readCloudDevice({device,userId,mqtt}) {
  const id = device.device_id.replaceAll(':','');
  const timestamp = Date.now();
  const hash = md5(`timestamp=${timestamp}&api_secret=${userId.slice(timestamp % 10)}`);
  const clientId = `client_${userId}_${hash}_${timestamp}`;
  const host = mqtt.mqtt_host || 'mqtt.sydpower.com';
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('Invalid MQTT host');
  const ws = new WebSocket(`ws://${host}:8083/mqtt`, 'mqtt');
  ws.binaryType = 'arraybuffer';
  try {
    const reading = waitForReading(ws, id, Number(device.modbus_address) || 17, Math.max(79, Math.min(Number(device.modbus_count) || 80, 125)));
    await new Promise((resolve,reject) => { if (ws.readyState === WebSocket.OPEN) return resolve(); ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',()=>reject(new Error('MQTT connection failed')),{once:true}); });
    ws.send(connectPacket(clientId, mqtt.access_token, 'client123'));
    return await reading;
  } finally { try { ws.close(); } catch {} }
}
export async function collect(env) {
  if (!env.BRIGHTEMS_USERNAME || !env.BRIGHTEMS_PASSWORD) throw new Error('BrightEMS account secrets are not configured');
  const cloud = await credentials(env);
  const reading = await readCloudDevice(cloud);
  const recordedAt = new Date().toISOString();
  const id = cloud.device.device_id.replaceAll(':','');
  await env.DB.prepare(`INSERT INTO telemetry (device_id,sample_id,recorded_at,charge_percent,input_w,output_w,ac_input_w,dc_input_w,remaining_minutes,grid_present,discharging,fault,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, `${recordedAt}-${crypto.randomUUID()}`, recordedAt, reading.charge_percent, reading.input_w, reading.output_w, reading.ac_input_w, reading.dc_input_w, reading.remaining_minutes, reading.grid_present, reading.discharging, reading.fault, JSON.stringify(reading.named)).run();
  return { device:id, recordedAt, charge:reading.charge_percent };
}
export default {
  async scheduled(_controller, env, ctx) { ctx.waitUntil(collect(env)); },
  async fetch(request, env) {
    // A manual diagnostic trigger is available only with the existing ingest secret.
    if (new URL(request.url).pathname !== '/check' || request.method !== 'POST' || !env.INGEST_SECRET || request.headers.get('authorization') !== `Bearer ${env.INGEST_SECRET}`) return new Response('Not found', {status:404});
    try { return Response.json(await collect(env)); }
    catch (error) { console.error(error.message); return Response.json({error:error.message},{status:502}); }
  }
};
