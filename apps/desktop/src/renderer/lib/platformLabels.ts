// single source of truth for platform-dependent UI copy — same renderer bundle ships on both macOS and
// Windows, so labels branch on window.alliminate.platform (set from process.platform in the preload)
// instead of being hardcoded to one OS.
export const isWindows = window.alliminate.platform === 'win32';

export const osName = isWindows ? 'Windows' : 'macOS';
export const thisDeviceLabel = isWindows ? 'This PC' : 'This Mac';
export const fileBrowserName = isWindows ? 'File Explorer' : 'Finder';
export const showInFileBrowserLabel = isWindows ? 'Show in File Explorer' : 'Show in Finder';
export const biometricName = isWindows ? 'Windows Hello' : 'Touch ID';
export const deviceNounLower = isWindows ? 'this PC' : 'this Mac';

// a paired peer's platform is data (NodeJS.Platform reported over the wire), not this build's OS — never
// assume the other end of a pairing is a Mac just because that used to be the only Master this app had.
export function platformDisplayName(platform: string): string {
  if (platform === 'darwin') return 'Mac';
  if (platform === 'win32') return 'PC';
  if (platform === 'android') return 'phone';
  return 'device';
}
