// One-time script: obtains a Google Drive OAuth refresh token and writes it into .env.
// Run with: node scripts/google-drive-auth.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const ENV_PATH = path.join(__dirname, '..', '.env');
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;

require('dotenv').config({ path: ENV_PATH });

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('missing code');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'no refresh_token returned — you may need to revoke prior access at ' +
          'https://myaccount.google.com/permissions and retry',
      );
    }

    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    const updated = envContent.replace(
      /GOOGLE_DRIVE_REFRESH_TOKEN=.*/,
      `GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`,
    );
    fs.writeFileSync(ENV_PATH, updated);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>AllieMinate connected to Google Drive.</h2><p>You can close this tab.</p>');
    console.log('refresh token saved to .env');
  } catch (err) {
    res.writeHead(500);
    res.end('token exchange failed, check terminal');
    console.error(err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(PORT, () => {
  console.log('opening browser for Google consent...');
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log('open this URL manually:\n' + authUrl);
  }
});
