<div align="center">

```
  ___   _      _     _____ ________  ________ _   _   ___ _____ _____ 
 / _ \ | |    | |   |_   _|  ___|  \/  |_   _| \ | | / _ \_   _|  ___|
/ /_\ \| |    | |     | | | |__ | .  . | | | |  \| |/ /_\ \| | | |__  
|  _  || |    | |     | | |  __|| |\/| | | | | . ` ||  _  || | |  __| 
| | | || |____| |_____| |_| |___| |  | |_| |_| |\  || | | || | | |___ 
\_| |_/\_____/\_____/\___/\____/\_|  |_/\___/\_| \_/\_| |_/\_/ \____/ 
```

**One workspace for every cloud you own, and every device you carry.**

*Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud — unified on your Mac, paired with your phone, with nothing routed through anyone's server but the providers themselves.*

---

[![Version](https://img.shields.io/badge/Version-v1.0.0-00e5ff?style=flat-square&labelColor=050d1a)](.)
[![TypeScript](https://img.shields.io/badge/TypeScript-Backend%20%26%20UI-00e5ff?style=flat-square&logo=typescript&logoColor=00e5ff&labelColor=050d1a)](https://www.typescriptlang.org)
[![Kotlin](https://img.shields.io/badge/Kotlin-Android-00e5ff?style=flat-square&logo=kotlin&logoColor=00e5ff&labelColor=050d1a)](https://kotlinlang.org)
[![Electron](https://img.shields.io/badge/Electron-Desktop-00e5ff?style=flat-square&logo=electron&logoColor=00e5ff&labelColor=050d1a)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-00e5ff?style=flat-square&logo=react&logoColor=00e5ff&labelColor=050d1a)](https://react.dev)
[![Fastify](https://img.shields.io/badge/Fastify-Backend-00e5ff?style=flat-square&logo=fastify&logoColor=00e5ff&labelColor=050d1a)](https://fastify.dev)
[![Android](https://img.shields.io/badge/Android-Companion%20App-00e5ff?style=flat-square&logo=android&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![macOS DMG](https://img.shields.io/badge/macOS-DMG%20Installer-00e5ff?style=flat-square&logo=apple&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%C2%B7%20Windows%20soon-0d2a3a?style=flat-square&logo=apple&logoColor=c8e8f0&labelColor=050d1a)](.)
[![Status](https://img.shields.io/badge/Status-Active%20Dev-1db954?style=flat-square&labelColor=050d1a)](.)

</div>

---

## What is AllieMinate?

AllieMinate ties **Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud** into a single unified workspace on your Mac — as many accounts per provider as you want, browsed, searched, and managed like one drive instead of six separate apps fighting for your menu bar.

It then pairs with your **Android phone** directly over your local network — no cloud relay, no AllieMinate-operated server in the middle. Once paired, your phone's photos and files show up on your Mac, your Mac's clouds show up on your phone, and both stay in sync even if your phone's IP changes — including when your Mac is tethered to your phone's own hotspot.

---

## Feature Matrix

<table>
<tr>
<td width="50%" valign="top">

**☁️ Cloud Aggregation**
- Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, pCloud — multiple accounts per provider
- One combined Files view across every account, or browse each cloud's real native folder tree
- Pinned Folders — bookmark any real cloud folder, not just AllieMinate's own space
- Drag-and-drop upload, download, rename, move, copy
- Full Trash with recovery across every provider
- Cross-cloud Search — one query, every account, every device

**🔄 Sync Engine**
- Two-way, backup-only, or download-only sync between any local folder and a cloud account
- Real conflict detection and resolution
- User-editable ignore-pattern rules
- Bandwidth throttling and storage quota warnings
- Android Sync Pairs — point a phone folder at a cloud destination, it pushes automatically in the background

**📱 Cross-Device**
- Pair your phone over Wi-Fi (QR code) or USB — straight LAN connection, no cloud relay
- Browse your phone's photos, videos, documents, and archives from the Mac, and vice versa
- Nearby Share — drop a file on any paired (or unpaired, nearby) device without touching a cloud account
- Continuity — open a file on your phone, pick it back up on your Mac
- Remote unlock — approve unlocking your Mac from your paired phone
- Self-healing pairing — Mac and phone rediscover each other automatically across network changes, including your phone's own hotspot

</td>
<td width="50%" valign="top">

**🔒 Security**
- App Lock (Touch ID / PIN) on both platforms
- OAuth tokens and API keys never committed — `.env`-only, fully gitignored
- Every paired-device request signed and token-authenticated

**🖥️ Desktop Experience**
- **Menu Bar Icon** — lives in your Mac's menu bar the whole time AllieMinate is running, no need to keep the full window open:
  - Click it for a floating panel of your most recent cloud and device files, thumbnails included
  - Pick which cloud account (or "Combined") the panel shows, right from a dropdown in the panel itself
  - Filter to device backups only, or hide them, without leaving the panel
  - Drag a file straight out of the panel into Finder, Mail, Slack, anywhere — like dragging from a real folder
  - Click a file to reveal it in Finder, or a phone file to pull it down and open it, in one click
  - A live progress bar for anything currently uploading or downloading
- Global search across every cloud and every paired device at once
- Full-featured Trash, Transfer History, and per-account storage breakdown

**📷 Google Photos**
- Browse and pick from your linked Google Photos library alongside your Drive files

**⚡ Performance**
- Every provider fetch runs in parallel — one slow account never blocks the others
- Bounded-concurrency batch operations — bulk delete/move/copy don't hammer any single provider
- Streaming uploads for large files — never fully buffered in memory

**🛠️ Reliability**
- Auto-restart on backend crash, with automated crash logging
- Global unhandled-rejection safety net — one bad promise doesn't take down the whole app
- Trash entries survive a failed cloud delete instead of silently vanishing

</td>
</tr>
</table>

---

## Android Companion App

<table>
<tr>
<td width="50%" valign="top">

**Features**
- Full cloud browsing — every account your Mac has connected, right on your phone
- Camera/folder backup to any cloud account, with live progress notifications
- Sync Pairs — one-way background push from a phone folder to a cloud destination
- Nearby Share — send/receive files with any paired or nearby AllieMinate device
- Cross-device search
- App Lock (biometric)
- Pair via QR code or USB — no manual IP entry

</td>
<td width="50%" valign="top">

**Requirements**
- Android 8.0 (API 26)+
- Same Wi-Fi network as your Mac (or your Mac tethered to your phone's hotspot)
- AllieMinate running on your Mac

**Download**

[![Download APK](https://img.shields.io/badge/Download-AllieMinate.apk-00e5ff?style=for-the-badge&logo=android&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)

> Enable *Install from unknown sources* in Android Settings → Security before installing.

</td>
</tr>
</table>

### Pairing

1. On Mac: **Devices → Pair an Android** — shows a QR code (or offers USB).
2. On phone: **Devices → Pair a Device** — scan the QR code, or connect via USB.
3. Done. Your phone appears on the Mac's Devices page, and your Mac's clouds appear in the phone's Cloud Services tab.

---

## Architecture

```
apps/
  backend/    Fastify server — the real brain. Talks to every cloud provider and every
              paired device, handles sync, trash, search, pairing. Runs locally, never
              leaves your machine.
  desktop/    Electron + React. The macOS (Windows in progress) app — a UI shell around
              the backend, plus native bits: tray, USB pairing, lock screen.
  android/    Kotlin + Jetpack Compose. The phone app — its own local HTTP server so the
              Mac can browse it, plus background workers for sync and camera backup.
packages/
  shared/     TypeScript types shared between backend and desktop.
```

The backend is the single source of truth. The desktop app is a window onto it; the phone talks to it directly over the LAN once paired. Nothing about your files or accounts passes through any AllieMinate-operated server, because there isn't one.

---

## Running the Mac App

The fastest way to get AllieMinate on your Mac is the `.dmg` installer — no Node, no build step, just drag it into Applications like any other Mac app:

[![Download DMG](https://img.shields.io/badge/Download-AllieMinate.dmg-00e5ff?style=for-the-badge&logo=apple&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)

1. Download and open the `.dmg`.
2. Drag **AllieMinate** onto the **Applications** shortcut next to it.
3. Open AllieMinate from Applications or Launchpad. Since it isn't notarized with a paid Apple Developer certificate, the first launch will be blocked by Gatekeeper — right-click the app → **Open** (or **System Settings → Privacy & Security → Open Anyway**) to get past that one-time warning.
4. Add your cloud accounts from **Settings**.

Prefer building from source instead (e.g. to make changes)? Keep reading below.

### Requirements
- macOS
- [Node.js](https://nodejs.org) 20+

### 1 — Clone & install
```bash
git clone https://github.com/1nonlyvansh/AllieMinate.git
cd AllieMinate
npm install
```

### 2 — Cloud credentials
```bash
cp .env.example .env
```
Fill in whichever providers you want — the app only shows providers it finds valid config for.

| Provider | Required env vars |
|---|---|
| Google Drive | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` |
| OneDrive | `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, `ONEDRIVE_REFRESH_TOKEN` |
| Backblaze B2 | `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` |
| IDrive e2 | `IDRIVE_E2_ENDPOINT`, `IDRIVE_E2_REGION`, `IDRIVE_E2_BUCKET`, `IDRIVE_E2_ACCESS_KEY_ID`, `IDRIVE_E2_SECRET_ACCESS_KEY` |
| pCloud | `PCLOUD_CLIENT_ID`, `PCLOUD_CLIENT_SECRET`, `PCLOUD_ACCESS_TOKEN` |
| MEGA | `MEGA_EMAIL`, `MEGA_PASSWORD` |

> Google Drive and OneDrive need an OAuth app registered in their own developer consoles to get a client ID/secret. B2, IDrive e2, and pCloud use plain API keys from their dashboards. MEGA just uses your account login.

### 3 — Build & run
```bash
bash apps/desktop/build/build-app.sh
open ~/Applications/AllieMinate.app
```
Compiles the backend, desktop main process, and both renderer bundles, then assembles and installs a full `.app` to `~/Applications`. Re-run after any change — it preserves your connected accounts, pairings, and pinned folders across rebuilds.

---

## Running the Android App

### Requirements
- Android Studio (Iguana or newer)
- A phone or emulator on Android 8.0 (API 26)+

### 1 — Open & build
Open `apps/android` in Android Studio, let Gradle sync, then Run on a connected device or emulator.

### 2 — Pair
See [Pairing](#pairing) above.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js · TypeScript · Fastify |
| Desktop | Electron · React 18 · TypeScript |
| Android | Kotlin · Jetpack Compose · WorkManager |
| Shared types | TypeScript (`packages/shared`) |
| Cloud SDKs | Google APIs (Drive), Microsoft Graph (OneDrive), AWS SDK v3 (S3-compatible: B2, IDrive e2), MEGA SDK, pCloud REST API |
| Device pairing | LAN HTTP + token auth, UDP broadcast discovery (self-healing reconnect) |

---

## A Few Things Worth Knowing

- **Nothing about your files touches an AllieMinate server** — there isn't one. Cloud calls go straight to each provider's own API; device-to-device traffic stays on your LAN.
- **`.env` is gitignored on purpose.** Never commit real credentials — see `.env.example` for the shape without the values.
- Windows desktop is next — the backend and shared types are already platform-agnostic; only the Electron shell needs Windows packaging.

---

## Roadmap

- [ ] Windows desktop app
- [ ] File versioning / point-in-time restore
- [ ] Public share links with expiry
- [ ] Selective sync UI polish

---

<div align="center">

**AllieMinate v1.0.0** — cross-platform cloud aggregation · self-healing device pairing · zero-relay sync

*A space with you.*

<br>

[![GitHub](https://img.shields.io/badge/GitHub-1nonlyvansh%2FAllieMinate-00e5ff?style=flat-square&logo=github&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh)
&nbsp;
[![Instagram](https://img.shields.io/badge/Instagram-%401nonlyvansh-00e5ff?style=flat-square&logo=instagram&logoColor=00e5ff&labelColor=050d1a)](https://instagram.com/1nonlyvansh)

</div>
