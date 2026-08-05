import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

export interface S3CompatConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function readS3Config(prefix: string): S3CompatConfig | null {
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const region = process.env[`${prefix}_REGION`];
  const bucket = process.env[`${prefix}_BUCKET`];
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`] ?? process.env[`${prefix}_KEY_ID`];
  const secretAccessKey =
    process.env[`${prefix}_SECRET_ACCESS_KEY`] ?? process.env[`${prefix}_APPLICATION_KEY`];

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface MegaConfig {
  email: string;
  password: string;
}

export interface PCloudConfig {
  accessToken: string;
  apiHost: string;
}

export interface OneDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function readGoogleDriveConfig(): GoogleDriveConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function readMegaConfig(): MegaConfig | null {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

function readPCloudConfig(): PCloudConfig | null {
  const accessToken = process.env.PCLOUD_ACCESS_TOKEN;
  const apiHost = process.env.PCLOUD_API_HOST ?? 'api.pcloud.com';
  if (!accessToken) return null;
  return { accessToken, apiHost };
}

function readOneDriveConfig(): OneDriveConfig | null {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export const config = {
  port: Number(process.env.ALLIMINATE_PORT ?? 4310),
  b2: readS3Config('B2'),
  idriveE2: readS3Config('IDRIVE_E2'),
  googleDrive: readGoogleDriveConfig(),
  mega: readMegaConfig(),
  pcloud: readPCloudConfig(),
  onedrive: readOneDriveConfig(),
};
