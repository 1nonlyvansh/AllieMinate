import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Gmail's (and every other webmail's) compose-by-URL flow has no parameter for attaching a local file —
// that's a deliberate browser security boundary, not a gap we can work around from a link. macOS Mail.app
// is scriptable via AppleScript and CAN attach real files to a real draft, so that's the only way to get
// an actually-one-click "compose with attachments already on it" experience — the draft is left visible
// and unsent so the user still has to hit Send themselves, same as before.
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function composeMailWithAttachments(params: {
  to: string;
  subject: string;
  body: string;
  attachmentPaths: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const attachLines = params.attachmentPaths
    .map((p) => `make new attachment with properties {file name:(POSIX file "${escapeAppleScriptString(p)}")} at after last paragraph`)
    .join('\n');

  const script = `
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${escapeAppleScriptString(params.subject)}", content:"${escapeAppleScriptString(params.body)}", visible:true}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"${escapeAppleScriptString(params.to)}"}
    ${attachLines}
  end tell
  activate
end tell
`;

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
