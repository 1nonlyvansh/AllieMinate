import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const BACKEND_PORT = 4310;
const PHONE_SERVER_PORT = 4311;
const ADB_TIMEOUT_MS = 8000;

// USB pairing (Phase 6) reuses the exact same /pair/start + /pair/verify handshake as LAN/QR pairing —
// the only thing that changes is the transport underneath: `adb reverse` makes the phone's own
// localhost:4310 reach this Mac's backend, and `adb forward` makes this Mac's localhost:4311 reach the
// phone's LocalHttpServer. No app-level protocol changes, per the original Phase 6 plan.

// `adb` on bare PATH only exists if the user's shell profile puts it there — plenty of Mac users have
// Android Studio (which bundles platform-tools) without ever adding it to PATH. Check the common install
// spots directly instead of just failing.
const CANDIDATE_PATHS = [
  'adb',
  path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
];

let resolvedAdbPath: string | null | undefined; // undefined = not checked yet, null = checked, not found

async function resolveAdbPath(): Promise<string | null> {
  if (resolvedAdbPath !== undefined) return resolvedAdbPath;
  for (const candidate of CANDIDATE_PATHS) {
    if (candidate !== 'adb' && !fs.existsSync(candidate)) continue;
    try {
      await execFileAsync(candidate, ['version'], { timeout: ADB_TIMEOUT_MS });
      resolvedAdbPath = candidate;
      return candidate;
    } catch {
      // not this one — keep looking
    }
  }
  resolvedAdbPath = null;
  return null;
}

async function runAdb(args: string[]): Promise<{ ok: boolean; output: string }> {
  const adbPath = await resolveAdbPath();
  if (!adbPath) return { ok: false, output: 'adb not found' };
  try {
    const { stdout, stderr } = await execFileAsync(adbPath, args, { timeout: ADB_TIMEOUT_MS });
    return { ok: true, output: (stdout || stderr).trim() };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function isAdbAvailable(): Promise<boolean> {
  return (await resolveAdbPath()) !== null;
}

export async function listUsbDevices(): Promise<string[]> {
  const result = await runAdb(['devices']);
  if (!result.ok) return [];
  return result.output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]);
}

export async function connectUsbTunnel(): Promise<{ ok: boolean; error?: string }> {
  const available = await isAdbAvailable();
  if (!available) {
    return {
      ok: false,
      error:
        'adb not found — install Android platform-tools (e.g. "brew install android-platform-tools") or install Android Studio, which bundles it',
    };
  }

  const devices = await listUsbDevices();
  if (devices.length === 0) {
    return { ok: false, error: 'No phone detected over USB — plug it in and enable USB debugging in Developer Options' };
  }

  const reverseResult = await runAdb(['reverse', `tcp:${BACKEND_PORT}`, `tcp:${BACKEND_PORT}`]);
  if (!reverseResult.ok) return { ok: false, error: `adb reverse failed: ${reverseResult.output}` };

  const forwardResult = await runAdb(['forward', `tcp:${PHONE_SERVER_PORT}`, `tcp:${PHONE_SERVER_PORT}`]);
  if (!forwardResult.ok) return { ok: false, error: `adb forward failed: ${forwardResult.output}` };

  return { ok: true };
}

export async function disconnectUsbTunnel(): Promise<void> {
  await runAdb(['reverse', '--remove', `tcp:${BACKEND_PORT}`]);
  await runAdb(['forward', '--remove', `tcp:${PHONE_SERVER_PORT}`]);
}

/** Launches AllieMinate on the USB-connected phone with the pairing details baked into a deep link —
 * skips the QR scan entirely for USB. The phone's own app shows a branded "Connect <this Mac>?" Yes/No +
 * fingerprint confirmation before it actually pairs (see PendingPairRequest on the Android side) — the
 * ADB authorization dialog (if this Mac hasn't been trusted by the phone before) is a separate, one-time,
 * OS-level prompt that has to happen first for `adb` to see the device at all. */
export async function launchPairDeepLink(code: string, macName: string): Promise<{ ok: boolean; error?: string }> {
  const uri = `alliminate://pair?host=localhost:${BACKEND_PORT}&code=${code}&name=${encodeURIComponent(macName)}`;
  // `adb shell <args>` joins everything after "shell" into ONE string and hands it to the *phone's* shell
  // to parse — execFile's argv array only protects the local `adb` invocation, not that remote parse. The
  // unquoted `&` in the URI was getting read as a shell background operator on-device, splitting the
  // command into pieces and turning "com.alliminate.android/.MainActivity" into something the phone's
  // shell tried to run as its own command ("inaccessible or not found"). Single-quoting the URI for the
  // remote shell fixes it — safe here since every dynamic part of the URI is already percent-encoded, so
  // it can never contain a literal single quote.
  const result = await runAdb([
    'shell',
    'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${uri}'`, 'com.alliminate.android/.MainActivity',
  ]);
  if (!result.ok) return { ok: false, error: `couldn't launch AllieMinate on the phone: ${result.output}` };
  return { ok: true };
}
