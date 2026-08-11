import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Same pattern as pairing.test.ts: ALLIMINATE_DATA_DIR must be set before ignoreRules.ts is first
// imported, since it reads the env var into a module-level path at import time.
let ignoreRules: typeof import('./ignoreRules');

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alliminate-ignore-test-'));
  process.env.ALLIMINATE_DATA_DIR = dir;
  ignoreRules = await import('./ignoreRules');
});

describe('default rules (no syncIgnoreRules.json saved yet)', () => {
  test('matches the built-in defaults exactly by name', () => {
    expect(ignoreRules.isIgnored('.DS_Store')).toBe(true);
    expect(ignoreRules.isIgnored('.git')).toBe(true);
    expect(ignoreRules.isIgnored('node_modules')).toBe(true);
    expect(ignoreRules.isIgnored('.localized')).toBe(true);
  });

  test('does not ignore an ordinary file name', () => {
    expect(ignoreRules.isIgnored('photo.jpg')).toBe(false);
    expect(ignoreRules.isIgnored('My Document.docx')).toBe(false);
  });

  test('"*.tmp" wildcard matches any name ending in .tmp, nothing else', () => {
    expect(ignoreRules.isIgnored('download.tmp')).toBe(true);
    expect(ignoreRules.isIgnored('.tmp')).toBe(true);
    expect(ignoreRules.isIgnored('tmp.txt')).toBe(false);
  });

  test('matching is exact-name, not substring — "node_modules_backup" is not ignored', () => {
    expect(ignoreRules.isIgnored('node_modules_backup')).toBe(false);
  });
});

describe('user-saved rules override the defaults', () => {
  test('saveIgnoreRules replaces the active rule set, verified by loadIgnoreRules and isIgnored', () => {
    ignoreRules.saveIgnoreRules(['*.log', 'Thumbs.db']);

    expect(ignoreRules.loadIgnoreRules()).toEqual(['*.log', 'Thumbs.db']);
    expect(ignoreRules.isIgnored('debug.log')).toBe(true);
    expect(ignoreRules.isIgnored('Thumbs.db')).toBe(true);
    // .DS_Store was a default but is NOT in the saved custom set anymore
    expect(ignoreRules.isIgnored('.DS_Store')).toBe(false);
  });

  test('"?" wildcard matches exactly one character', () => {
    ignoreRules.saveIgnoreRules(['file?.txt']);
    expect(ignoreRules.isIgnored('file1.txt')).toBe(true);
    expect(ignoreRules.isIgnored('file12.txt')).toBe(false);
    expect(ignoreRules.isIgnored('file.txt')).toBe(false);
  });
});
