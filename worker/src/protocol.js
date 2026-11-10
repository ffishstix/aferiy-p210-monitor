import CryptoJS from 'crypto-js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const md5 = value => CryptoJS.MD5(value).toString();
export const hmacMd5 = (value, key) => CryptoJS.HmacMD5(value, key).toString();
export const signature = (body, key) => hmacMd5(Object.keys(body).sort().filter(k => body[k]).map(k => `${k}=${body[k]}`).join('&'), key);

function remainingLength(value) {
  const bytes = [];
  do { let digit = value % 128; value = Math.floor(value / 128); if (value) digit |= 128; bytes.push(digit); } while (value);
  return bytes;
}
export function mqttString(value) {
  const bytes = textEncoder.encode(value);
  return [bytes.length >> 8, bytes.length & 255, ...bytes];
}
export function packet(header, body) {
  return Uint8Array.from([header, ...remainingLength(body.length), ...body]);
}
export function connectPacket(clientId, username, password) {
  return packet(0x10, [...mqttString('MQTT'), 4, 0xc2, 0, 60, ...mqttString(clientId), ...mqttString(username), ...mqttString(password)]);
}
export function subscribePacket(deviceId) {
  const topics = ['state', 'faultCode', 'client/+', 'webhook'].map(s => `${deviceId}/device/response/${s}`);
  topics[3] = `${deviceId}/device/webhook`;
  return packet(0x82, [0, 1, ...topics.flatMap(topic => [...mqttString(topic), 0])]);
}
export function publishPacket(topic, payload) {
  return packet(0x30, [...mqttString(topic), ...payload]);
}
export function parsePacket(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 2) throw new Error('Short MQTT packet');
  let length = 0, multiplier = 1, index = 1, digit;
  do { if (index >= bytes.length) throw new Error('Truncated MQTT length'); digit = bytes[index++]; length += (digit & 127) * multiplier; multiplier *= 128; } while (digit & 128 && index < 5);
  if (bytes.length < index + length) throw new Error('Truncated MQTT packet');
  let topic = null, payload = bytes.slice(index, index + length);
  if ((bytes[0] >> 4) === 3) {
    const topicLength = (payload[0] << 8) | payload[1];
    topic = textDecoder.decode(payload.slice(2, topicLength + 2));
    payload = payload.slice(topicLength + 2);
  }
  return { type: bytes[0] >> 4, topic, payload };
}
export function crc16(data) {
  let crc = 0xffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1; }
  return crc;
}
export function readRequest(address = 17, code = 4, count = 80) {
  const body = [address, code, 0, 0, count >> 8, count & 255];
  const crc = crc16(body);
  return Uint8Array.from([...body, crc >> 8, crc & 255]);
}
const registerNames = { 0:'dcChargePower',2:'acChargePower',3:'pv1ChargePower',4:'pv2ChargePower',5:'pv3ChargePower',6:'pv4ChargePower',7:'acGridPower',12:'acOutputPower',19:'batteryVoltage',20:'totalOutputPower',21:'chargingFlag',39:'usbOutputPower',52:'ambientTemp',56:'batterySOCx10',58:'remainChargeTimeMin',71:'remainChargeTime',72:'remainDischargeTime',78:'totalDcDischargePower' };
export function decodeModbus(input) {
  const bytes = new Uint8Array(input);
  if (bytes.length < 8 || bytes[1] !== 4) return null;
  const start = (bytes[2] << 8) | bytes[3], count = (bytes[4] << 8) | bytes[5], size = 6 + 2 * count + 2;
  if (bytes.length !== size || crc16(bytes.slice(0, size - 2)) !== ((bytes[size - 2] << 8) | bytes[size - 1])) return null;
  const named = {};
  for (let i = 0; i < count; i++) if (registerNames[start + i]) named[registerNames[start + i]] = (bytes[6 + i * 2] << 8) | bytes[7 + i * 2];
  const soc = named.batterySOCx10 / 10;
  if (!Number.isFinite(soc) || soc < 0 || soc > 100) return null;
  const solar = Math.max(...[1,2,3,4].map(i => named[`pv${i}ChargePower`] || 0));
  const ac = (named.acChargePower || 0) + (named.acGridPower || 0);
  const dc = (named.dcChargePower || 0) + solar;
  const output = Math.max(named.totalOutputPower || 0, (named.acOutputPower || 0) + (named.totalDcDischargePower || 0) + (named.usbOutputPower || 0));
  const discharging = output > 5 && ac + dc < output;
  // Conservative rough P210 runtime at the present load; verify against the real unit.
  const remaining = discharging ? Math.round((2048 * soc / 100) / (Math.max(output - ac - dc, 1) * 1.5 + 22) * 60) : null;
  return { named, charge_percent:soc, input_w:ac + dc, output_w:output, ac_input_w:ac, dc_input_w:dc, remaining_minutes:remaining, grid_present:ac > 5 ? 1 : 0, discharging:discharging ? 1 : 0, fault:null };
}
