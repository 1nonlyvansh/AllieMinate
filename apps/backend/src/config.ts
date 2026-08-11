import dotenv from 'dotenv';
import { envPath } from './paths';

dotenv.config({ path: envPath() });

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

// AllieMinate's own Google Cloud OAuth client (Desktop app type — Google treats this secret as a
// public identifier, not a confidential one, for installed apps: https://developers.google.com/identity/protocols/oauth2/native-app).
// Lets "Add Google Account" work out of the box with no per-user Google Cloud project setup.
// The actual values are NEVER committed — GitHub's push protection rejects a plaintext OAuth client
// secret outright regardless of Google's own "not truly confidential for installed apps" stance, since
// a public repo is a far easier scrape target than a compiled binary. build-app.sh's pristine-bundle
// stage injects these two lines into the DISTRIBUTED .env (the one shipped in the .dmg/.exe), sourced
// from a gitignored local secrets file — see apps/backend/.oauth-defaults.env.example for the shape.
// A user's own GOOGLE_DRIVE_CLIENT_ID/_SECRET in their personal .env still overrides this if set.
export function googleDriveClientId(): string | undefined {
  return process.env.GOOGLE_DRIVE_CLIENT_ID;
}

export function googleDriveClientSecret(): string | undefined {
  return process.env.GOOGLE_DRIVE_CLIENT_SECRET;
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
  const clientId = googleDriveClientId();
  const clientSecret = googleDriveClientSecret();
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
