import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// pairing.ts reads ALLIMINATE_DATA_DIR into a module-level const at import time (see paths.ts), so it
// must be set BEFORE the module is first imported — a dynamic import after setting the env var, rather
// than a static top-level import, is what makes that ordering work. Using a real temp dir (not a mock)
// means loadPairedDevices/savePairedDevices exercise the actual fs.readFileSync/writeFileSync path this
// module uses in production, isolated from the developer's real devices.json.
let pairing: typeof import('./pairing');

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alliminate-pairing-test-'));
  process.env.ALLIMINATE_DATA_DIR = dir;
  pairing = await import('./pairing');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('paired device lookup', () => {
  test('loadPairedDevices returns [] when no devices.json exists yet', () => {
    expect(pairing.loadPairedDevices()).toEqual([]);
  });

  test('findByToken finds a saved device by its exact token and rejects an unknown one', () => {
    const device: import('./pairing').PairedDevice = {
      id: 'dev-1',
      name: 'Test Phone',
      platform: 'android' as NodeJS.Platform,
      host: '192.168.0.42',
      token: 'real-token-abc123',
      pairedAt: new Date().toISOString(),
    };
    pairing.savePairedDevices([device]);

    expect(pairing.findByToken('real-token-abc123')).toEqual(device);
    expect(pairing.findByToken('wrong-token')).toBeUndefined();
    expect(pairing.findByToken('')).toBeUndefined();
  });
});

describe('pairing code lifecycle', () => {
  test('a freshly generated code is a 6-digit numeric string', () => {
    const code = pairing.generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  test('consumePairingCode accepts a valid pending code exactly once (single-use)', () => {
    const code = pairing.generatePairingCode();
    expect(pairing.consumePairingCode(code)).toBe(true);
    // second redemption of the same code must fail — it was already consumed
    expect(pairing.consumePairingCode(code)).toBe(false);
  });

  test('consumePairingCode rejects a code that was never generated', () => {
    expect(pairing.consumePairingCode('000000')).toBe(false);
  });

  test('consumePairingCode rejects a code after its 5-minute TTL expires', () => {
    vi.useFakeTimers();
    const code = pairing.generatePairingCode();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(pairing.consumePairingCode(code)).toBe(false);
  });

  test('rejectPairingCode marks a code rejected, and pairingCodeStatus reports it until the reject TTL passes', () => {
    vi.useFakeTimers();
    const code = pairing.generatePairingCode();
    pairing.rejectPairingCode(code);

    expect(pairing.pairingCodeStatus(code)).toBe('rejected');
    // rejected codes must not be redeemable even though they were technically still "pending" a moment ago
    expect(pairing.consumePairingCode(code)).toBe(false);

    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(pairing.pairingCodeStatus(code)).toBe('unknown');
  });

  test('pairingCodeStatus reports "unknown" for a code that was never generated', () => {
    expect(pairing.pairingCodeStatus('999999')).toBe('unknown');
  });
});
