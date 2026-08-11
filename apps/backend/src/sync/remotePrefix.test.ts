import { describe, expect, test } from 'vitest';
import { uniqueRemotePrefix } from './remotePrefix';

describe('uniqueRemotePrefix', () => {
  test('builds a plain "root/name" prefix when nothing collides', () => {
    expect(uniqueRemotePrefix('Sync', 'Camera Roll', [])).toBe('Sync/Camera Roll');
    expect(uniqueRemotePrefix('Universal Sync', 'Notes', ['Sync/Camera Roll'])).toBe('Universal Sync/Notes');
  });

  test('appends " (2)", " (3)", ... only when the plain name is actually taken', () => {
    expect(uniqueRemotePrefix('Sync', 'Photos', ['Sync/Photos'])).toBe('Sync/Photos (2)');
    expect(uniqueRemotePrefix('Sync', 'Photos', ['Sync/Photos', 'Sync/Photos (2)'])).toBe('Sync/Photos (3)');
    expect(uniqueRemotePrefix('Sync', 'Photos', ['Sync/Photos', 'Sync/Photos (3)'])).toBe('Sync/Photos (2)');
  });

  test('does not collide across roots — "Sync/Photos" taken does not block "Universal Sync/Photos"', () => {
    expect(uniqueRemotePrefix('Universal Sync', 'Photos', ['Sync/Photos'])).toBe('Universal Sync/Photos');
  });

  test('strips path separators and collapses whitespace instead of producing a nested/garbled key', () => {
    expect(uniqueRemotePrefix('Sync', 'a/b\\c', [])).toBe('Sync/a-b-c');
    expect(uniqueRemotePrefix('Sync', '  My   Folder  ', [])).toBe('Sync/My Folder');
  });

  test('falls back to "Folder" for a name that is empty after cleaning', () => {
    expect(uniqueRemotePrefix('Sync', '   ', [])).toBe('Sync/Folder');
  });
});
