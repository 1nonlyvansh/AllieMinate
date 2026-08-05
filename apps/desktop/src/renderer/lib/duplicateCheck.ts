const API_BASE = 'http://localhost:4310';

function withCopySuffix(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}_(COPY)${name.slice(dot)}` : `${name}_(COPY)`;
}

/** Checks the destination's current files for name collisions before a copy/move actually happens — the
 * backend blindly overwrites same-named files today (that's how "pasted 3x = 3 quiet overwrites/duplicates"
 * happened), so this has to run client-side first. Returns null if the user cancelled after being warned;
 * otherwise returns each item's actual destination filename (renamed with a "_(COPY)" suffix wherever it
 * collided, left alone otherwise). */
export async function resolveDestNames<T extends { name: string }>(
  dest: { folderId?: string; providerId?: string },
  items: T[],
): Promise<(T & { destName: string })[] | null> {
  const url = dest.folderId
    ? `${API_BASE}/folders/${dest.folderId}/files`
    : `${API_BASE}/providers/${dest.providerId}/browse`;

  let existingNames = new Set<string>();
  try {
    const res = await fetch(url);
    const data = await res.json();
    existingNames = new Set((data.files ?? []).map((f: { path: string }) => f.path.split('/').pop()));
  } catch {
    // couldn't check — proceed without renaming rather than blocking the whole paste on a listing failure
    return items.map((it) => ({ ...it, destName: it.name }));
  }

  const collisions = items.filter((it) => existingNames.has(it.name));
  if (collisions.length === 0) return items.map((it) => ({ ...it, destName: it.name }));

  const proceed = window.confirm(
    collisions.length === 1
      ? `"${collisions[0].name}" already exists at the destination. Paste it as a copy?`
      : `${collisions.length} of ${items.length} file(s) already exist at the destination. Paste them as copies?`,
  );
  if (!proceed) return null;

  return items.map((it) => ({ ...it, destName: existingNames.has(it.name) ? withCopySuffix(it.name) : it.name }));
}
