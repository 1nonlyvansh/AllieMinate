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

*Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud — unified on your Mac and Windows PC, paired with your phone, with nothing routed through anyone's server but the providers themselves.*

---

[![Version](https://img.shields.io/badge/Version-v2.8.8-00e5ff?style=flat-square&labelColor=050d1a)](.)
[![TypeScript](https://img.shields.io/badge/TypeScript-Backend%20%26%20UI-00e5ff?style=flat-square&logo=typescript&logoColor=00e5ff&labelColor=050d1a)](https://www.typescriptlang.org)
[![Kotlin](https://img.shields.io/badge/Kotlin-Android-00e5ff?style=flat-square&logo=kotlin&logoColor=00e5ff&labelColor=050d1a)](https://kotlinlang.org)
[![Electron](https://img.shields.io/badge/Electron-Desktop-00e5ff?style=flat-square&logo=electron&logoColor=00e5ff&labelColor=050d1a)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-00e5ff?style=flat-square&logo=react&logoColor=00e5ff&labelColor=050d1a)](https://react.dev)
[![Fastify](https://img.shields.io/badge/Fastify-Backend-00e5ff?style=flat-square&logo=fastify&logoColor=00e5ff&labelColor=050d1a)](https://fastify.dev)
[![Android](https://img.shields.io/badge/Android-Companion%20App-00e5ff?style=flat-square&logo=android&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![macOS DMG](https://img.shields.io/badge/macOS-DMG%20Installer-00e5ff?style=flat-square&logo=apple&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-In%20Progress-0d2a3a?style=flat-square&logo=windows&logoColor=c8e8f0&labelColor=050d1a)](.)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Android-0d2a3a?style=flat-square&labelColor=050d1a)](.)
[![Status](https://img.shields.io/badge/Status-Active%20Dev-1db954?style=flat-square&labelColor=050d1a)](.)

</div>

---

## What is AllieMinate?

AllieMinate ties **Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud** into a single unified workspace on your Mac and Windows PC — as many accounts per provider as you want, browsed, searched, and managed like one drive instead of six separate apps fighting for your taskbar.

It then pairs with your **Android phone**, and with other **Mac/Windows machines**, directly over your local network — no cloud relay, no AllieMinate-operated server in the middle. Once paired, files, clipboard text, and live status flow directly between your devices: your phone's photos show up on your desktop, your desktop's clouds show up on your phone, folders stay in sync across every device you grant them to, and copying on one machine lets you paste on another.

---

## Feature Matrix

<table>
<tr>
<td width="50%" valign="top">

**☁️ Cloud Aggregation**
- Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, pCloud — multiple accounts per provider (rename or remove any linked account individually, including the primary one)
- One combined Files view across every account, or browse each cloud's real native folder tree
- Pinned Folders — bookmark any real cloud folder, not just AllieMinate's own space
- Drag-and-drop upload, download, rename, move, copy
- Full Trash with recovery across every provider
- Cross-cloud Search — one query, every account, every device
- Preview images and video inline (zoom, rotate, custom video controls) before ever downloading

**🔄 Sync Engine**
- Sync Pairs — two-way, backup-only, or download-only sync between any local folder and a cloud account **or a paired device**, with a real folder-tree destination picker (browse and create new folders on the remote side, not just a flat dropdown)
- Real conflict detection and resolution, with a dedicated Sync Trash (soft-delete both directions)
- User-editable ignore-pattern rules, bandwidth throttling, storage quota warnings
- Live per-pair progress and file counts, pause/resume independent of disabling a pair
- Deleting a Sync Pair requires an explicit confirmation **and** a device-authentication step (Touch ID/PIN on desktop, fingerprint/face/PIN on Android) — not a single accidental click away
- **Universal Sync Folder** — one cloud login, one host folder, broadcast to every device you grant it to at once (Mac, Windows, and Android simultaneously) instead of wiring up a separate pair per device

**📱 Cross-Device**
- Pair your phone over Wi-Fi (QR code) or USB, and pair Mac/Windows machines with each other — straight LAN connection, no cloud relay
- Up to 5 paired "master" devices per phone at once
- Browse a paired device's own files by category, with a full remote-browser (Add/Delete/Move/Share) for anything living in a Master's own Sync Pair
- Nearby Share — drop a file on any paired (or unpaired, nearby) device without touching a cloud account
- **Universal Clipboard** — copy text on one desktop, paste on another, or on a paired phone, automatically
- Continuity — open a file on your phone, pick it back up on your Mac/PC
- Remote unlock — approve unlocking your Mac/PC from a paired phone
- Live "device connected/disconnected" OS notifications, with custom alert sounds (toggle to silence)
- Self-healing pairing — devices rediscover each other automatically across network changes, including a phone's own hotspot

</td>
<td width="50%" valign="top">

**🔒 Security**
- App Lock (Touch ID on Mac, fingerprint/face/PIN on Android) on every platform
- Destructive actions (like deleting a Sync Pair) gated behind device authentication independent of App Lock being on
- OAuth tokens and API keys never committed — `.env`-only, fully gitignored
- Every paired-device request signed and token-authenticated

**🖥️ Desktop Experience**
- **Menu Bar / Tray Icon** — lives in your system tray the whole time AllieMinate is running, no need to keep the full window open:
  - Click it for a floating panel of your most recent cloud and device files, thumbnails included, with the SAME inline preview the main window uses
  - Pick which cloud account (or "Combined") the panel shows, right from a dropdown in the panel itself
  - Drag a file straight out of the panel into Finder/Explorer, Mail, Slack, anywhere — like dragging from a real folder
  - Drop a file onto the tray icon to send it straight to a paired device or a cloud folder
  - A live progress bar for anything currently uploading or downloading
- Finder-style multi-select everywhere: click, ⌘/Ctrl-click, Shift-range, and marquee drag-select, feeding a shared bulk-action bar (download/copy/cut/move-to-another-cloud/pin/delete)
- Global search across every cloud and every paired device at once
- Full-featured Trash, Transfer History (both directions — sent to a device, or pulled from one), and per-account storage breakdown
- **About AllieMinate** page — features, use cases, and direct links to the project's GitHub, developer profiles, and support contact, right inside the app

**📷 Google Photos**
- Browse and pick from your linked Google Photos library alongside your Drive files

**⚡ Performance & Reliability**
- Every provider fetch runs in parallel — one slow account never blocks the others
- Bounded-concurrency batch operations — bulk delete/move/copy don't hammer any single provider
- Streaming uploads for large files — never fully buffered in memory
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
- Full cloud browsing — every account a paired Mac/PC has connected, right on your phone
- Camera/folder backup to any cloud account, with live progress notifications
- Sync Pairs — background push from a phone folder to a cloud destination, plus full two-way pull for Universal Sync folders
- Full remote browser (Add/Delete/Move/Share) for a paired Master's own Sync Pair folders
- Nearby Share — send/receive files with any paired or nearby AllieMinate device
- Explore & Send Files to a paired Master, with tap-to-preview before transferring
- Cross-device search
- App Lock (biometric) + device-auth confirmation on destructive actions
- Pair via QR code or USB — no manual IP entry, up to 5 masters at once
- **About AllieMinate** screen (Settings → About AllieMinate) with the same feature/developer/support info as desktop

</td>
<td width="50%" valign="top">

**Requirements**
- Android 8.0 (API 26)+
- Same Wi-Fi network as your Mac/PC (or your desktop tethered to your phone's hotspot)
- AllieMinate running on the desktop you're pairing with

**Download**

[![Download APK](https://img.shields.io/badge/Download-AllieMinate.apk-00e5ff?style=for-the-badge&logo=android&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)

> Enable *Install from unknown sources* in Android Settings → Security before installing.

</td>
</tr>
</table>

### Pairing

1. On desktop: **Devices → Pair an Android** (or **Pair a Device** for another Mac/PC) — shows a QR code (or offers USB).
2. On phone: **Devices → Pair a Device** — scan the QR code, or connect via USB.
3. Done. Your phone appears on the desktop's Devices page, and the desktop's clouds appear in the phone's Cloud Services tab.

---

## Windows

The backend, shared types, and almost all of the renderer UI are already platform-agnostic — a Windows build runs the same feature set as macOS today (device pairing, Universal Sync, Universal Clipboard, battery reporting, notifications, the full click/preview/multi-select model, and more), currently via a manual dev-mode launch. A proper `.exe` installer (NSIS via electron-builder, matching the `.dmg`'s drag-and-drop simplicity) is in progress — see the Roadmap below.

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
- **Universal Clipboard is one-way (desktop → phone) by design, not a bug.** Android blocks background apps from reading the system clipboard unless they're the focused foreground app or the default keyboard — a platform restriction, not something AllieMinate can work around (even Microsoft's own first-party Phone Link clipboard feature is the same direction only). Desktop → phone clipboard sync works automatically; phone → desktop does not.
- **macOS Share Extension ("Share to Connected Devices") is built but not yet enabled.** The extension compiles and installs correctly, but macOS Gatekeeper refuses to register any Share Extension that isn't signed with a paid Apple Developer ID — there's no user-facing override the way there is for a regular app launch. It'll light up once the project has a real Developer ID; until then, use Nearby Share or a Sync Pair instead.
- Windows is actively in progress — the backend and shared types are already fully platform-agnostic and running there today (pairing, Universal Sync, Universal Clipboard, notifications, and more all verified working); what's left is packaging a proper `.exe` installer.

---

## Roadmap

- [ ] Windows `.exe` installer (NSIS / electron-builder)
- [ ] macOS Share Extension enabled (needs a paid Apple Developer ID)
- [ ] Windows Hello for destructive-action confirmation (Mac already has Touch ID; Windows currently falls back to app PIN)
- [ ] File versioning / point-in-time restore
- [ ] Public share links with expiry
- [ ] Selective sync UI polish

---

<div align="center">

**AllieMinate v2.8.8** — cross-platform cloud aggregation · self-healing device pairing · zero-relay sync

*A space with you.*

<br>

[![GitHub](https://img.shields.io/badge/GitHub-1nonlyvansh%2FAllieMinate-00e5ff?style=flat-square&logo=github&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate)
&nbsp;
[![Developer](https://img.shields.io/badge/GitHub-1nonlyvansh-00e5ff?style=flat-square&logo=github&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh)
&nbsp;
[![Instagram](https://img.shields.io/badge/Instagram-%401nonlyvansh-00e5ff?style=flat-square&logo=instagram&logoColor=00e5ff&labelColor=050d1a)](https://instagram.com/1nonlyvansh)
&nbsp;
[![LinkedIn](https://img.shields.io/badge/LinkedIn-vanshkishore-00e5ff?style=flat-square&logo=linkedin&logoColor=00e5ff&labelColor=050d1a)](https://www.linkedin.com/in/vanshkishore/)

<br>

Need help or have a suggestion? [vansh080605@gmail.com](mailto:vansh080605@gmail.com) · [WhatsApp +91 91361 58580](https://wa.me/919136158580)

</div>
