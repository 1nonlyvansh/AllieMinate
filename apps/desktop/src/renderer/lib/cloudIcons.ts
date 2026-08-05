import b2 from '../assets/clouds/b2.png';
import googleDrive from '../assets/clouds/google-drive.png';
import idriveE2 from '../assets/clouds/idrive-e2.png';
import mega from '../assets/clouds/mega.png';
import onedrive from '../assets/clouds/onedrive.png';
import pcloud from '../assets/clouds/pcloud.png';

// keyed by StorageProviderId — transparent-background PNGs, not the flat-colored SVG glyphs these replace.
export const CLOUD_ICONS: Record<string, string> = {
  b2,
  'google-drive': googleDrive,
  'idrive-e2': idriveE2,
  mega,
  onedrive,
  pcloud,
};
