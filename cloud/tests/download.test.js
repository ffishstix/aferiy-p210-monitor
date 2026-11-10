import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../public/download.html', import.meta.url), 'utf8');

test('all advertised Windows binaries exist, match their architecture and published checksum', () => {
  for (const [name, machine] of [['win-x64', 0x8664], ['win-arm64', 0xaa64], ['win-x86', 0x014c]]) {
    const bytes = readFileSync(new URL(`../public/downloads/${name}/BatteryWatch.exe`, import.meta.url));
    const header = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt16LE(header + 4), machine);
    const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.ok(page.includes(`/downloads/${name}/BatteryWatch.exe`));
    assert.ok(page.includes(hash));
  }
});
