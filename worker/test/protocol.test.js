import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPacket, crc16, decodeHolding, decodeModbus, isWriteAck, parsePacket, publishPacket, readRequest, signature, subscribePacket, writeRequest } from '../src/protocol.js';
import { plausibleSettings, resolveControl } from '../src/controls.js';

test('BrightEMS signature matches HMAC-MD5 fixture', () => {
  assert.equal(signature({method:'x',params:'{}',spaceId:'abc',timestamp:123}, 'key'), '69a808a8e91999f5964b3c4332049532');
});

test('MQTT packets encode and parse payload', () => {
  const connect = connectPacket('client', 'token', 'pass');
  assert.equal(connect[0], 0x10);
  assert.equal(subscribePacket('device')[0], 0x82);
  const data = publishPacket('device/client/request/data', readRequest());
  const parsed = parsePacket(data);
  assert.equal(parsed.topic, 'device/client/request/data');
  assert.equal(parsed.payload[1], 4);
});

test('Modbus response validates checksum and maps battery values', () => {
  const registers = new Array(80).fill(0);
  registers[20] = 180;
  registers[56] = 145;
  const body = [17,4,0,0,0,80,...registers.flatMap(n => [n >> 8,n & 255])];
  const crc = crc16(body);
  const bytes = Uint8Array.from([...body, crc >> 8, crc & 255]);
  const parsed = decodeModbus(bytes);
  assert.equal(parsed.charge_percent, 14.5);
  assert.equal(parsed.output_w, 180);
  assert.equal(parsed.named.inputRegisters.length, 80);
  bytes[8] ^= 1;
  assert.equal(decodeModbus(bytes), null);
});

test('holding register response exposes settings without writing them', () => {
  const registers = new Array(86).fill(0);
  registers[24] = 1;
  registers[84] = 0x010f;
  const body = [17,3,0,0,0,86,...registers.flatMap(n => [n >> 8,n & 255])];
  const crc = crc16(body);
  const parsed = decodeHolding(Uint8Array.from([...body, crc >> 8, crc & 255]));
  assert.equal(parsed.usbOutputCmd, 1);
  assert.equal(parsed.lowBatteryNotification, 0x010f);
  assert.equal(parsed.holdingRegisters.length, 86);
});

test('writes use validated registers, ranges, and device current limit', () => {
  const holding = new Array(86).fill(0);
  holding[17] = 12; holding[66] = 100; holding[67] = 1000;
  assert.equal(plausibleSettings(holding), true);
  assert.deepEqual(resolveControl('acOutput', false, holding), { register: 26, value: 0 });
  assert.deepEqual(resolveControl('ledMode', 3, holding), { register: 27, value: 3 });
  assert.deepEqual(resolveControl('dischargeLimit', 50, holding), { register: 66, value: 500 });
  assert.deepEqual(resolveControl('chargeLimit', 60, holding), { register: 67, value: 600 });
  assert.deepEqual(resolveControl('dcInputCurrent', 12, holding), { register: 20, value: 12 });
  assert.equal(resolveControl('dcInputCurrent', 13, holding), null);
  assert.equal(resolveControl('chargeLimit', 59, holding), null);
  assert.equal(resolveControl('dischargeLimit', 51, holding), null);
  assert.equal(resolveControl('acOutput', 0, holding), null);
  assert.equal(resolveControl('sleepTime', 0, holding), null);
  assert.equal(resolveControl('lowBatteryNotify', true, holding), null);
  assert.equal(resolveControl('factoryReset', true, holding), null);
  assert.equal(resolveControl('acOutput', false, []), null);
});

test('write acknowledgement must exactly match the requested command', () => {
  const request = writeRequest(17, 26, 0);
  assert.deepEqual(Array.from(request), [17, 6, 0, 26, 0, 0, 0x9d, 0xaa]);
  assert.equal(isWriteAck(request, request), true);
  const wrong = Uint8Array.from(request); wrong[5] = 1;
  assert.equal(isWriteAck(wrong, request), false);
});
