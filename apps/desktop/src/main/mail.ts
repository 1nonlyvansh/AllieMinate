import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePowerShellString(s: string): string {
  return s.replace(/'/g, "''").replace(/`/g, '``');
}

async function composeMailWindows(params: {
  to: string;
  subject: string;
  body: string;
  attachmentPaths: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const attachmentArgs = params.attachmentPaths
    .map((p) => `-Attachments '${escapePowerShellString(p)}'`)
    .join(' ');

  const script = `
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = '${escapePowerShellString(params.to)}'
$mail.Subject = '${escapePowerShellString(params.subject)}'
$mail.Body = '${escapePowerShellString(params.body)}'
${attachmentArgs.split(' ').filter(Boolean).map(a => `$mail.Attachments.Add(${a})`).join('\n')}
$mail.Display()
`;

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Outlook') || msg.includes('COM') || msg.includes('80040154') || msg.includes('80080005')) {
      const mailtoUrl = `mailto:${encodeURIComponent(params.to)}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
      try {
        await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', mailtoUrl]);
        return { ok: true, error: 'Opened default mail client (attachments not supported via mailto). Please attach files manually.' };
      } catch {
        return { ok: false, error: 'Outlook not available and default mail client failed to open.' };
      }
    }
    return { ok: false, error: msg };
  }
}

async function composeMailMac(params: {
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

export async function composeMailWithAttachments(params: {
  to: string;
  subject: string;
  body: string;
  attachmentPaths: string[];
}): Promise<{ ok: boolean; error?: string }> {
  if (process.platform === 'win32') {
    return composeMailWindows(params);
  }
  return composeMailMac(params);
}
