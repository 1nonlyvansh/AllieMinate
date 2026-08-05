const API_BASE = 'http://localhost:4310';

/** Real macOS pasteboard copy for a remote cloud file — distinct from the app's own internal Copy/Cut
 * (which just stages a move/paste-into-another-folder). Downloads/reuses a local cached copy on the
 * backend, then writes that real file's path to the OS pasteboard so a Cmd+V anywhere outside AllieMinate
 * (Finder, Mail, etc) pastes an actual file. */
export async function copyFileToClipboard(params: { folderId?: string; providerId?: string; key: string; mimeType?: string }): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/files/cache-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'copy failed');
    const result = await window.alliminate.copyLocalFile(data.path);
    if (!result.ok) throw new Error(result.error ?? 'copy failed');
  } catch (err) {
    window.alert("Couldn't copy this file to your clipboard — " + (err instanceof Error ? err.message : String(err)));
  }
}
