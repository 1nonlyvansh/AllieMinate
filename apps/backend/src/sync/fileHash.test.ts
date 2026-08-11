import { describe, expect, test, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashBuffer, hashFile } from './fileHash';

const tmpFiles: string[] = [];
function tmpFile(content: Buffer | string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alliminate-hash-')), 'f');
  fs.writeFileSync(p, content);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

describe('hashBuffer', () => {
  test('returns the real MD5 hex digest of the buffer', () => {
    const data = Buffer.from('AllieMinate sync test payload');
    const expected = crypto.createHash('md5').update(data).digest('hex');
    expect(hashBuffer(data)).toBe(expected);
  });

  test('same content always hashes to the same value; different content hashes differently', () => {
    const a = hashBuffer(Buffer.from('same content'));
    const b = hashBuffer(Buffer.from('same content'));
    const c = hashBuffer(Buffer.from('different content'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('returns null for a buffer over the 200MB size limit instead of hashing it', () => {
    const oversized = Buffer.alloc(200 * 1024 * 1024 + 1);
    expect(hashBuffer(oversized)).toBeNull();
  });
});

describe('hashFile', () => {
  test('streams a real file from disk and returns the same digest as hashBuffer would', async () => {
    const content = 'content read from a real temp file on disk';
    const filePath = tmpFile(content);
    const expected = hashBuffer(Buffer.from(content));
    await expect(hashFile(filePath)).resolves.toBe(expected);
  });

  test('resolves null (not a rejection) for a path that does not exist', async () => {
    await expect(hashFile('/definitely/not/a/real/path/on/disk')).resolves.toBeNull();
  });
});
