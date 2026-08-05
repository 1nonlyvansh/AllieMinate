# AllieMinate

**One app for every cloud you own, and every device you carry.**

AllieMinate ties Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud into a single unified workspace on your Mac — and pairs it with your Android phone over your local network, so both feel like one connected system instead of six separate apps.

---

## What it does

### ☁️ Cloud aggregation
- Connect **Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud** — as many accounts per provider as you want.
- One combined **Files** view across every account, or browse each cloud's real, native folder tree individually.
- **Pinned Folders** — bookmark any real cloud folder (not just AllieMinate's own space) for one-click access.
- Drag-and-drop upload, download, rename, move, copy, and a full **Trash** with recovery, sitting on top of every provider's native file operations.
- Cross-cloud **Search** — one query, every account, every device.

### 🔄 Sync Engine
- Turn any local folder into a live, two-way (or backup-only, or download-only) sync target against a cloud account.
- Real conflict detection, ignore-pattern rules, bandwidth throttling, and quota warnings.
- Android has its own lightweight one-way Sync Pairs — point a phone folder (like Camera or Screenshots) at a cloud destination and it pushes automatically in the background.

### 📱 Cross-device, not just cross-cloud
- **Pair your phone** with your Mac over Wi-Fi (QR code) or USB — no cloud relay, straight LAN connection.
- Browse your phone's photos, videos, documents, and archives from the Mac, and vice versa.
- **Nearby Share** — drop a file on any paired (or even unpaired, nearby) device without touching a cloud account at all.
- **Continuity** — open a file on your phone, pick it back up on your Mac.
- **Remote unlock** — approve unlocking your Mac from your paired phone.
- Self-healing pairing: if your Mac and phone drift onto different networks (like your phone's own hotspot), they automatically rediscover each other instead of requiring a re-pair.

### 🔒 Built to stay out of your way
- App Lock (Touch ID / PIN) on both platforms.
- A menu bar tray on Mac with live recent files, drag-out, and quick actions — no need to keep the full window open.
- Everything else — trash retention, transfer history, storage breakdown per account — just works in the background.

---

## How it's built

AllieMinate is a monorepo with three moving pieces:

```
apps/
  backend/    Fastify server — the real brain. Talks to every cloud provider, every paired
              device, handles sync, trash, search, pairing. Runs locally, never leaves your machine.
  desktop/    Electron + React. The macOS (and in-progress Windows) app — a UI shell around
              the backend, plus native bits (tray, USB pairing, lock screen).
  android/    Kotlin + Jetpack Compose. The phone app — its own local HTTP server so the Mac
              can browse it, plus background workers for sync/backup.
packages/
  shared/     TypeScript types shared between backend and desktop.
```

The backend is the single source of truth — the desktop app is just a window onto it, and the phone talks to it directly over the LAN once paired. Nothing about your files or accounts passes through any AllieMinate-operated server, because there isn't one.

---

## Running the Mac app

### Requirements
- macOS
- [Node.js](https://nodejs.org) 20+
- npm

### 1. Clone and install
```bash
git clone https://github.com/<your-username>/AllieMinate.git
cd AllieMinate
npm install
```

### 2. Set up your cloud credentials
```bash
cp .env.example .env
```
Fill in credentials for whichever providers you want to connect. You don't need all of them — the app only shows providers it finds valid config for.

| Provider | Required env vars |
|---|---|
| Google Drive | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` |
| OneDrive | `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, `ONEDRIVE_REFRESH_TOKEN` |
| Backblaze B2 | `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` |
| IDrive e2 | `IDRIVE_E2_ENDPOINT`, `IDRIVE_E2_REGION`, `IDRIVE_E2_BUCKET`, `IDRIVE_E2_ACCESS_KEY_ID`, `IDRIVE_E2_SECRET_ACCESS_KEY` |
| pCloud | `PCLOUD_CLIENT_ID`, `PCLOUD_CLIENT_SECRET`, `PCLOUD_ACCESS_TOKEN` |
| MEGA | `MEGA_EMAIL`, `MEGA_PASSWORD` |

> Google Drive and OneDrive need an OAuth app registered in their respective developer consoles (Google Cloud Console / Azure App Registrations) to get a client ID/secret — B2, IDrive e2, and pCloud use straightforward API keys from their own dashboards, and MEGA just uses your account login.

### 3. Build and run
```bash
bash apps/desktop/build/build-app.sh
open ~/Applications/AllieMinate.app
```
This compiles the backend, desktop main process, and both renderer bundles, then assembles and code-signs (ad-hoc) a full `.app` bundle installed to `~/Applications`. Re-run the same script after any source change — it preserves your connected accounts, pairings, and pinned folders across rebuilds.

---

## Running the Android app

### Requirements
- Android Studio (Iguana or newer)
- A phone or emulator on **Android 8.0 (API 26)+**

### 1. Open the project
Open `apps/android` in Android Studio and let it sync Gradle.

### 2. Build & install
Run the `app` configuration on a connected device or emulator — standard Android Studio ▶️ Run.

### 3. Pair with your Mac
With the Mac app running:
1. On Mac: **Devices → Pair a Device**, or **Devices → Pair an Android** for a QR code / USB flow.
2. On phone: **Devices → Pair a Device**, scan the QR code (same Wi-Fi network) or connect via USB.
3. Once paired, your phone shows up on the Mac's Devices page, and your Mac's clouds show up in the phone's Cloud Services tab — no separate login needed on either side.

---

## A few things worth knowing

- **Nothing about your files touches an AllieMinate server** — there isn't one. The backend runs locally, cloud calls go straight to each provider's own API, and device-to-device traffic stays on your LAN.
- **`.env` is gitignored on purpose.** Never commit real credentials — see `.env.example` for the shape without the values.
- The Windows desktop build is next up — the backend and shared types are already platform-agnostic; only the Electron shell needs Windows-specific packaging.

---

## Roadmap

- [ ] Windows desktop app
- [ ] File versioning / point-in-time restore
- [ ] Public share links with expiry
- [ ] Selective sync UI polish

---

<p align="center">Built for people who are tired of six different cloud apps fighting for the same menu bar icon.</p>
