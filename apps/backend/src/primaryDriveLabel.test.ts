import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let primaryDriveLabel: typeof import('./primaryDriveLabel');
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alliminate-drive-label-test-'));
  process.env.ALLIMINATE_DATA_DIR = dataDir;
  primaryDriveLabel = await import('./primaryDriveLabel');
});

describe('loadPrimaryDriveLabelOverride', () => {
  test('returns undefined when no override file has been saved yet', () => {
    expect(primaryDriveLabel.loadPrimaryDriveLabelOverride()).toBeUndefined();
  });

  test('round-trips a saved label exactly', () => {
    primaryDriveLabel.savePrimaryDriveLabelOverride('Work Drive');
    expect(primaryDriveLabel.loadPrimaryDriveLabelOverride()).toBe('Work Drive');
  });

  test('trims whitespace, and a whitespace-only saved label is treated as no override', () => {
    primaryDriveLabel.savePrimaryDriveLabelOverride('  Personal  ');
    expect(primaryDriveLabel.loadPrimaryDriveLabelOverride()).toBe('Personal');

    primaryDriveLabel.savePrimaryDriveLabelOverride('   ');
    expect(primaryDriveLabel.loadPrimaryDriveLabelOverride()).toBeUndefined();
  });

  test('returns undefined instead of throwing when the saved file is corrupt JSON', () => {
    fs.writeFileSync(path.join(dataDir, 'primary-drive-label.json'), '{not valid json');
    expect(primaryDriveLabel.loadPrimaryDriveLabelOverride()).toBeUndefined();
  });
});
