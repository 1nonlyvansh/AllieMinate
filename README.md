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

*Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud — unified on your Mac, Windows PC, and Android phone, with nothing routed through anyone's server but the providers themselves.*

---

[![Version](https://img.shields.io/badge/Version-v2.8.8-00e5ff?style=flat-square&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/tag/v2.8.8)
[![License: MIT](https://img.shields.io/badge/License-MIT-00e5ff?style=flat-square&labelColor=050d1a)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Android-0d2a3a?style=flat-square&labelColor=050d1a)](#supported-platforms)
[![CI](https://img.shields.io/github/actions/workflow/status/1nonlyvansh/AllieMinate/ci.yml?branch=main&style=flat-square&label=CI&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/actions/workflows/ci.yml)
[![Status](https://img.shields.io/badge/Status-Active%20Dev-1db954?style=flat-square&labelColor=050d1a)](CHANGELOG.md)

[Website](https://allieminate.vercel.app/) · [Download](https://github.com/1nonlyvansh/AllieMinate/releases/latest) · [Changelog](CHANGELOG.md) · [Docs](docs/) · [Report a Bug](https://github.com/1nonlyvansh/AllieMinate/issues/new?template=bug_report.md)

</div>

---

## Contents

1. [What is AllieMinate?](#what-is-allieminate)
2. [Screenshots](#screenshots)
3. [Supported platforms](#supported-platforms)
4. [Download](#download)
5. [Installation](#installation)
6. [First launch](#first-launch)
7. [Cloud provider support](#cloud-provider-support)
8. [Device pairing](#device-pairing)
9. [Sync](#sync)
10. [Nearby Share](#nearby-share)
11. [Universal Clipboard](#universal-clipboard)
12. [Feature Matrix](#feature-matrix)
13. [Compatibility Matrix](#compatibility-matrix)
14. [Security & privacy model](#security--privacy-model)
15. [Architecture](#architecture)
16. [System requirements](#system-requirements)
17. [Known Issues](#known-issues)
18. [Troubleshooting](#troubleshooting)
19. [Developer Setup](#developer-setup)
20. [Testing](#testing)
21. [Contributing](#contributing)
22. [Roadmap](#roadmap)
23. [License](#license)
24. [Changelog / releases](#changelog--releases)
25. [Support / contact](#support--contact)

---

## What is AllieMinate?

AllieMinate ties **Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud** into a single unified workspace on your Mac and Windows PC — as many accounts per provider as you want, browsed, searched, and managed like one drive instead of six separate apps.

It then pairs with your **Android phone**, and with other **Mac/Windows machines**, directly over your local network — no cloud relay, no AllieMinate-operated server in the middle. Once paired, files, clipboard text, and live status flow directly between your devices: your phone's photos show up on your desktop, your desktop's clouds show up on your phone, folders stay in sync across every device you grant them to, and copying on one desktop lets you paste on another (or on your phone).

**Value proposition, plainly:** most cloud managers stop at "browse your cloud." AllieMinate also does device-to-device sync, LAN file transfer, clipboard sharing, and remote unlock — one app instead of four — with no subscription, no mandatory account, and (for every device-to-device feature) no server operated by this project standing between your devices.

---

## Screenshots

**None are currently checked into this repository.** Rather than fabricate mockups, here's exactly
what's missing and should be added under a future `docs/assets/screenshots/` (referenced from here
and from `apps/website`):

- [ ] Desktop — Files view (combined cloud view, multiple accounts)
- [ ] Desktop — Sync view (a Sync Pair card with live progress)
- [ ] Desktop — Devices view (a paired phone + another paired desktop)
- [ ] Desktop — the tray/menu bar quick-access panel
- [ ] Desktop — About AllieMinate page
- [ ] Android — Overview screen
- [ ] Android — Sync screen with a Universal Sync folder
- [ ] Android — a paired-device detail screen

If you're the maintainer picking this up: run the app, take these on a clean/representative account
(no personal file names visible), save as PNG under `docs/assets/screenshots/`, then replace this
section with actual `![...]()` image embeds.

---

## Supported platforms

| Platform | Status |
|---|---|
| macOS (Apple Silicon & Intel) | Shipped — `.dmg` installer |
| Windows 10/11 (64-bit) | Shipped — `.exe` installer |
| Android 8.0+ (API 26+) | Shipped — `.apk`, sideloaded (not on Play Store) |

None of the three installers are code-signed with a paid certificate yet — see
[First launch](#first-launch) for the one-time warning each platform shows and how to get past it, and
[Known Issues](#known-issues) for what that means in practice.

---

## Download

[![Download DMG](https://img.shields.io/badge/macOS-Download%20.dmg-00e5ff?style=for-the-badge&logo=apple&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![Download EXE](https://img.shields.io/badge/Windows-Download%20.exe-00e5ff?style=for-the-badge&logo=windows&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
[![Download APK](https://img.shields.io/badge/Android-Download%20.apk-00e5ff?style=for-the-badge&logo=android&logoColor=00e5ff&labelColor=050d1a)](https://github.com/1nonlyvansh/AllieMinate/releases/latest)

All installers are published on [GitHub Releases](https://github.com/1nonlyvansh/AllieMinate/releases) — the current version is **v2.8.8**. Verify your download's integrity against the SHA-256 checksum published with each release (see [docs/architecture/build-and-release.md](docs/architecture/build-and-release.md#generating-checksums)).

---

## Installation

Full per-platform walkthroughs, including the Gatekeeper/SmartScreen warning each one shows on first
run and how to uninstall/reset cleanly:

- **[macOS installation](docs/installation/macos.md)**
- **[Windows installation](docs/installation/windows.md)**
- **[Android installation](docs/installation/android.md)**

---

## First launch

1. Install per the guide above.
2. Get past the one-time unsigned-app warning (Gatekeeper on macOS, SmartScreen on Windows, "install
   unknown apps" on Android) — this is expected on every platform right now, not a sign of a bad
   download. See [Known Issues](#known-issues) for why.
3. Connect at least one cloud provider — see [Cloud provider support](#cloud-provider-support).
4. Optionally pair a phone or another desktop — see [Device pairing](#device-pairing).

---

## Cloud provider support

| Provider | Multi-account | Auth method |
|---|---|---|
| Google Drive | Yes | OAuth |
| OneDrive | Yes | OAuth |
| Backblaze B2 | Yes | API key pair |
| IDrive e2 | Yes | API key pair (S3-compatible) |
| pCloud | Yes | OAuth |
| MEGA | Yes | Account email/password |

Full connect-flow walkthrough: **[docs/getting-started/cloud-accounts.md](docs/getting-started/cloud-accounts.md)**.

---

## Device pairing

Pair a phone to a desktop, or two desktops to each other, over LAN (Wi-Fi QR code or USB) — no cloud
relay, no account. A phone can hold up to 5 simultaneous desktop pairings.

Full walkthrough: **[docs/getting-started/device-pairing.md](docs/getting-started/device-pairing.md)**.

---

## Sync

Sync Pairs keep a local folder in sync against a cloud account or a paired device — two-way,
backup-only, or download-only, with real conflict handling (newer file wins, older side preserved as
a conflict copy) and a Universal Sync mode that broadcasts one folder to every granted device at once.

Full walkthrough incl. conflict resolution and ignore rules: **[docs/getting-started/sync-configuration.md](docs/getting-started/sync-configuration.md)**.

---

## Nearby Share

Drop a file on any AllieMinate device visible on the same network — paired *or not* — with a real
accept/decline prompt on the receiving end. Separate from a Sync Pair: a one-off transfer, not an
ongoing sync relationship. Details: **[docs/features/overview.md#nearby-share](docs/features/overview.md#nearby-share)**.

---

## Universal Clipboard

Copy on a paired Mac or Windows machine, paste on another paired desktop or an Android phone,
automatically. **One direction only** — phone → desktop is not supported, and can't be reliably
worked around: Android blocks background apps from reading the system clipboard, a platform
restriction Microsoft's own first-party Phone Link clipboard feature hits too. Details:
**[docs/features/overview.md#universal-clipboard](docs/features/overview.md#universal-clipboard)**.

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
- Sync Pairs — two-way, backup-only, or download-only sync between any local folder and a cloud account **or a paired device**, with a real folder-tree destination picker
- Real conflict detection and resolution, with a dedicated Sync Trash (soft-delete both directions)
- User-editable ignore-pattern rules, real bandwidth throttling, storage quota warnings
- Live per-pair progress and file counts, pause/resume independent of disabling a pair
- Deleting a Sync Pair requires an explicit confirmation **and** a device-authentication step
- **Universal Sync Folder** — one cloud login, one host folder, broadcast to every device you grant it to at once

**📱 Cross-Device**
- Pair your phone over Wi-Fi (QR code) or USB, and pair Mac/Windows machines with each other
- Up to 5 paired "master" devices per phone at once
- Full remote-browser (Add/Delete/Move/Share) for anything living in a Master's own Sync Pair
- Nearby Share — drop a file on any paired (or unpaired, nearby) device
- Universal Clipboard — desktop → phone/desktop (see above)
- Continuity — open a file on your phone, pick it back up on your Mac/PC
- Remote unlock — approve unlocking your Mac/PC from a paired phone
- Live device connect/disconnect OS notifications, with custom alert sounds
- Self-healing pairing across network changes, including a phone's own hotspot

</td>
<td width="50%" valign="top">

**🔒 Security**
- App Lock (Touch ID on Mac, fingerprint/face/PIN on Android, app PIN everywhere) on every platform
- Destructive actions (like deleting a Sync Pair) gated behind device authentication independent of App Lock being on
- OAuth tokens and API keys never committed — `.env`-only, fully gitignored
- Every paired-device request token-authenticated

**🖥️ Desktop Experience**
- **Menu Bar / Tray Icon** — recent cloud and device files, thumbnails, inline preview, drag-out to Finder/Explorer, drop-to-send, live transfer progress
- Finder-style multi-select everywhere: click, ⌘/Ctrl-click, Shift-range, and marquee drag-select feeding a shared bulk-action bar
- Global search across every cloud and every paired device at once
- Full-featured Trash, two-directional Transfer History, per-account storage breakdown
- **About AllieMinate** page — features, use cases, GitHub/developer/support links, right inside the app

**📷 Google Photos**
- Browse and pick from your linked Google Photos library alongside your Drive files

**⚡ Performance & Reliability**
- Every provider fetch runs in parallel — one slow account never blocks the others
- Bounded-concurrency batch operations; streaming uploads for large files
- Auto-restart on backend crash, with automated crash logging
- Global unhandled-rejection safety net
- Trash entries survive a failed cloud delete instead of silently vanishing

</td>
</tr>
</table>

### Android Companion App

- Full cloud browsing — every account a paired Mac/PC has connected
- Camera/folder backup to any cloud account, with live progress notifications
- Sync Pairs — background push, plus full two-way pull for Universal Sync folders
- Full remote browser (Add/Delete/Move/Share) for a paired Master's own Sync Pair folders
- Nearby Share, cross-device search, App Lock (biometric) + device-auth on destructive actions
- Pair via QR code or USB, up to 5 masters at once
- **About AllieMinate** screen (Settings → About AllieMinate)

---

## Compatibility Matrix

Only marked ✅ where actually implemented and verified; ⚠️ marks a real but partial/limited implementation, not a missing feature.

| Feature | macOS | Windows | Android |
|---|:---:|:---:|:---:|
| Cloud aggregation | ✅ | ✅ | ✅ (browses a paired desktop's accounts) |
| Sync Pairs / Universal Sync | ✅ | ✅ | ✅ |
| Nearby Share | ✅ | ✅ | ✅ |
| Universal Clipboard | ✅ (send + receive) | ✅ (send + receive) | ⚠️ receive-only — can't send to desktop ([why](#universal-clipboard)) |
| Device pairing | ✅ | ✅ | ✅ |
| Biometric / destructive-action auth | ✅ Touch ID + app PIN | ⚠️ app PIN only — no Windows Hello yet | ✅ biometric + device credential |
| Connect/disconnect notifications | ✅ | ✅ | ✅ |
| macOS Share Extension | ⚠️ built, Gatekeeper-blocked ([why](#known-issues)) | ❌ not applicable | ❌ not applicable |

---

## Security & privacy model

- **No AllieMinate-operated server, anywhere.** Cloud calls go straight from your machine to each
  provider's own API; device-to-device traffic (pairing, sync, transfer, clipboard, Nearby Share)
  stays on your LAN.
- Pairing uses per-device tokens, not encryption of the LAN traffic itself — see the honest threat
  model in **[docs/architecture/security-model.md](docs/architecture/security-model.md)**.
- `.env` (OAuth secrets, API keys) is gitignored and never intended to be committed — see
  **[SECURITY.md](SECURITY.md)** for the full policy and how to report a vulnerability.
- App Lock and destructive-action authentication are described in the [Feature Matrix](#feature-matrix)
  above; what they do and don't protect against is in the security model doc linked above.

---

## Architecture

```
apps/
  backend/    Fastify server — the real brain. Talks to every cloud provider and every
              paired device, handles sync, trash, search, pairing. Runs locally, never
              leaves your machine.
  desktop/    Electron + React. The macOS/Windows app — a UI shell around the backend,
              plus native bits: tray, USB pairing, lock screen, Share Extension (macOS).
  android/    Kotlin + Jetpack Compose. The phone app — its own local HTTP server so a
              paired desktop can browse it, plus background workers for sync/backup.
  website/    Static marketing site — no build step, no backend.
packages/
  shared/     TypeScript types shared between backend and desktop.
```

The backend is the single source of truth on a desktop install; the desktop app is a window onto it;
a paired phone talks to it directly over the LAN. Full breakdown, a Mermaid diagram, and the
add-a-file data-flow walkthrough: **[docs/architecture/overview.md](docs/architecture/overview.md)**.

---

## System requirements

Practical minimums for an Electron + Node desktop app and a modern Compose Android app — not
lab-benchmarked, but defensible for the workload (a local Fastify server plus a Chromium-based UI):

| | Minimum |
|---|---|
| **macOS** | Apple Silicon or Intel Mac, macOS 12+, 4GB RAM, ~200MB free disk |
| **Windows** | Windows 10/11 64-bit, 4GB RAM, ~200MB free disk |
| **Android** | Android 8.0 (API 26)+, any device that can run a modern Compose app |

---

## Known Issues

Real, currently-shipping limitations — not hidden, not silently worked around:

- **Universal Clipboard is phone → desktop only in the other direction — not supported at all.**
  Android platform restriction, not a bug to file. See [Universal Clipboard](#universal-clipboard).
- **macOS Share Extension is built but not enabled.** Ad-hoc-signed Share Extensions are rejected by
  Gatekeeper with no user override; needs a paid Apple Developer ID. Use Nearby Share or a Sync Pair
  instead for now.
- **No Windows Hello yet.** Destructive-action authentication (e.g. deleting a Sync Pair) on Windows
  currently falls back to the app's own PIN rather than a native biometric prompt.
- **Two Settings → Sync Preferences controls are not wired to real logic**: the "Conflict resolution"
  dropdown (actual behavior is always newest-wins with a conflict copy, regardless of the selection)
  and "Pause sync on metered connection" toggle (no effect). Bandwidth throttling, the third control
  in that section, *is* real.
- **LAN traffic between paired devices is not TLS-encrypted.** Token-authenticated, but plaintext
  transport — fine on a trusted home/office network, not something to rely on over hostile Wi-Fi. See
  [docs/architecture/security-model.md](docs/architecture/security-model.md).
- **None of the three installers are code-signed with a paid certificate.** Expect a one-time
  Gatekeeper/SmartScreen/unknown-sources warning on first install — see [Installation](#installation).
- **The released Android `.apk` is a debug build**, signed with the default Android debug keystore —
  there is no release signing key configured yet.
- **No Android tests exist yet** (JVM unit or instrumented) — CI runs `testDebugUnitTest` but it's
  currently a no-op with zero test sources. Only the backend has real automated test coverage today
  (pure sync/pairing logic — see [Testing](#testing)). Android test coverage is a real gap, not
  hidden by the CI green checkmark.
- **8 known dependency vulnerabilities** (Electron, Fastify, and a `googleapis`-chain `uuid` advisory)
  require major-version bumps to fully resolve — tracked, not silently ignored. See
  [SECURITY.md](SECURITY.md#known-dependency-vulnerabilities-as-of-v288).

---

## Troubleshooting

Common problems and fixes, including the items above in more depth:
**[docs/troubleshooting/common-issues.md](docs/troubleshooting/common-issues.md)**.

---

## Developer Setup

### Requirements
- [Node.js](https://nodejs.org) 20+
- Android Studio (Iguana or newer), for the Android app
- macOS, to build the `.dmg` (the build script currently only runs there)

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
Fill in whichever providers you want — the app only shows providers it finds valid config for. See
**[docs/getting-started/cloud-accounts.md](docs/getting-started/cloud-accounts.md)** for where each
value comes from.

| Provider | Required env vars |
|---|---|
| Google Drive | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` |
| OneDrive | `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, `ONEDRIVE_REFRESH_TOKEN` |
| Backblaze B2 | `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` |
| IDrive e2 | `IDRIVE_E2_ENDPOINT`, `IDRIVE_E2_REGION`, `IDRIVE_E2_BUCKET`, `IDRIVE_E2_ACCESS_KEY_ID`, `IDRIVE_E2_SECRET_ACCESS_KEY` |
| pCloud | `PCLOUD_CLIENT_ID`, `PCLOUD_CLIENT_SECRET`, `PCLOUD_ACCESS_TOKEN` |
| MEGA | `MEGA_EMAIL`, `MEGA_PASSWORD` |

### 3 — Build & run (macOS)
```bash
bash apps/desktop/build/build-app.sh
open ~/Applications/AllieMinate.app
```
Compiles the backend, desktop main process, and both renderer bundles, then assembles and installs a
full `.app` to `~/Applications`. Re-run after any change — it preserves your connected accounts,
pairings, and pinned folders across rebuilds. This script has hardcoded local paths and is not
CI-portable as-is — see [docs/architecture/build-and-release.md](docs/architecture/build-and-release.md).

### Build & run (Windows)
Same source tree, no Windows-specific code changes needed to build — package with
electron-builder/NSIS on a Windows machine. There is no committed Windows build script yet; see
[docs/architecture/build-and-release.md](docs/architecture/build-and-release.md) for the current
manual process.

### Run the Android app
Open `apps/android` in Android Studio, let Gradle sync, then Run on a connected device or emulator.
Then see [Device pairing](#device-pairing).

---

## Testing

```bash
# Backend unit tests (Vitest) — pure-logic modules: pairing/token lifecycle, ignore-rule matching,
# content hashing, remote-prefix collision handling.
npm test --workspace=@alliminate/backend

# TypeScript typecheck (backend + desktop)
npm run build --workspace=@alliminate/shared
npx tsc --noEmit -p apps/backend/tsconfig.json
npx tsc --noEmit -p apps/desktop/tsconfig.json

# Android — compile + JVM unit tests
cd apps/android && ./gradlew compileDebugKotlin testDebugUnitTest
```

All of the above run in CI on every PR — see [.github/workflows/ci.yml](.github/workflows/ci.yml).
Test coverage is real but intentionally scoped to pure logic that doesn't need heavy mocking right
now (see [Known Issues](#known-issues) for what's not covered yet — HTTP route handlers, the full
two-way sync reconciliation engine, and any UI/instrumented Android tests). Expanding it is a welcome
contribution — see [CONTRIBUTING.md](CONTRIBUTING.md#tests).

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev setup, coding conventions, and the PR process.
Please also read the **[Code of Conduct](CODE_OF_CONDUCT.md)**.

---

## Roadmap

- [ ] Code-sign all three installers (Apple Developer ID, Windows code-signing cert, Android release key)
- [ ] macOS Share Extension enabled (blocked on the item above)
- [ ] Windows Hello for destructive-action confirmation
- [ ] Wire up (or remove) the non-functional Conflict Resolution / metered-connection Settings controls
- [ ] TLS for LAN device-to-device traffic
- [ ] File versioning / point-in-time restore
- [ ] Public share links with expiry
- [ ] Selective sync UI polish
- [ ] UI/instrumented test coverage (desktop + Android)

---

## License

[MIT](LICENSE) © 2026 Vansh Kishore Sharma.

---

## Changelog / releases

Full version history: **[CHANGELOG.md](CHANGELOG.md)**. Installers: **[GitHub Releases](https://github.com/1nonlyvansh/AllieMinate/releases)**.

---

## Support / contact

**Vansh Kishore Sharma** — [GitHub](https://github.com/1nonlyvansh) · [Instagram](https://instagram.com/1nonlyvansh) · [LinkedIn](https://www.linkedin.com/in/vanshkishore/)

Bug or feature request → [open an issue](https://github.com/1nonlyvansh/AllieMinate/issues/new/choose). Security issue → [SECURITY.md](SECURITY.md) (do not open a public issue). Anything else → [vansh080605@gmail.com](mailto:vansh080605@gmail.com) · [WhatsApp +91 91361 58580](https://wa.me/919136158580).

---

<div align="center">

**AllieMinate v2.8.8** — cross-platform cloud aggregation · self-healing device pairing · zero-relay sync

*A space with you.*

</div>
