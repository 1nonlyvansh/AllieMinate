// Every place that generates a remote key prefix for a new sync folder shares this — a human-readable
// "Sync/<name>" or "Universal Sync/<name>" path instead of the old opaque "<slug>-<random hex>" one, so a
// file's actual location (Google Drive: a real nested folder; every other provider: a real key prefix that
// already looked like a folder) reads the same way the app's own UI does. Collision-safe without falling
// back to a random suffix in the common case: only appends " (2)", " (3)", ... when the plain name is
// genuinely already taken by another folder syncing into the same account.
export function uniqueRemotePrefix(root: 'Sync' | 'Universal Sync', name: string, existingPrefixes: string[]): string {
  // real folder/key-prefix name — keep the human name as-is (spaces, case, punctuation) rather than the old
  // lowercase-hyphenated slug, just strip characters no provider's folder/path segment can hold.
  const cleaned = name.trim().replace(/[/\\]+/g, '-').replace(/\s+/g, ' ') || 'Folder';
  const base = `${root}/${cleaned}`;
  const existing = new Set(existingPrefixes);
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
