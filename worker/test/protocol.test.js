import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPacket, crc16, decodeHolding, decodeModbus, parsePacket, publishPacket, readRequest, signature, subscribePacket } from '../src/protocol.js';

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
