import { config } from '../config';
import { S3CompatibleBackend } from './S3CompatibleBackend';
import { GoogleDriveBackend } from './GoogleDriveBackend';
import { MegaBackend } from './MegaBackend';
import { PCloudBackend } from './PCloudBackend';
import { OneDriveBackend } from './OneDriveBackend';
import type { StorageBackend } from './StorageBackend';
import { loadDriveAccounts } from '../accounts';
import { isProviderDisabled } from '../disabledProviders';

// "Log Out" / "Log Out of All Services" persists which provider ids the user explicitly disconnected (see
// disabledProviders.ts) — credentials stay in .env/driveAccounts.json exactly as promised, but a logged-out
// provider must NOT come back to life just because the app restarted, which is what used to happen when
// this function unconditionally rebuilt every backend from stored credentials with no memory of a logout.
export function buildStorageBackends(): Map<string, StorageBackend> {
  const backends = new Map<string, StorageBackend>();

  if (config.b2 && !isProviderDisabled('b2')) backends.set('b2', new S3CompatibleBackend(config.b2));
  if (config.idriveE2 && !isProviderDisabled('idrive-e2')) backends.set('idrive-e2', new S3CompatibleBackend(config.idriveE2));
  if (config.googleDrive && !isProviderDisabled('google-drive')) backends.set('google-drive', new GoogleDriveBackend(config.googleDrive));
  if (config.mega && !isProviderDisabled('mega')) backends.set('mega', new MegaBackend(config.mega));
  if (config.pcloud && !isProviderDisabled('pcloud')) backends.set('pcloud', new PCloudBackend(config.pcloud));
  if (config.onedrive && !isProviderDisabled('onedrive')) backends.set('onedrive', new OneDriveBackend(config.onedrive));

  if (config.googleDrive) {
    for (const account of loadDriveAccounts()) {
      if (isProviderDisabled(account.accountId)) continue;
      backends.set(
        account.accountId,
        new GoogleDriveBackend({
          clientId: config.googleDrive.clientId,
          clientSecret: config.googleDrive.clientSecret,
          refreshToken: account.refreshToken,
        }),
      );
    }
  }

  return backends;
}

export type { StorageBackend } from './StorageBackend';
