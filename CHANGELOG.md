# Changelog

All notable changes to AllieMinate are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries below are generated from the
project's real commit history (`git log`), not invented — see each release's tag on GitHub for the
exact diff.

## [v2.8.8] — 2026-08-11

Current release. Installers: macOS `.dmg`, Windows `.exe`, Android `.apk` —
[GitHub Releases](https://github.com/1nonlyvansh/AllieMinate/releases/tag/v2.8.8).

### Added
- **Universal Sync Folder** — one cloud login, one host folder, broadcast to every paired device
  granted access at once, instead of setting up a separate Sync Pair per device.
- **Universal Clipboard** — copy on a Mac/Windows machine, paste on another paired desktop or an
  Android phone, automatically. (Phone → desktop direction is not supported — see Known Limitations.)
- Full remote file browser (Add / Delete / Move / Share) for a paired Master's own Sync Pair
  contents, on both desktop and Android.
- Sync Pair deletion now requires an explicit confirmation dialog **and** a device-authentication
  step (Touch ID/PIN on desktop, biometric/device-credential on Android).
- Connect/disconnect OS notifications for paired devices, with togglable custom alert sounds.
- "About AllieMinate" screen on desktop and Android — feature summary, use cases, developer and
  support links.
- macOS Share Extensions ("Share to Connected Devices" / "Add to Cloud Service") — built, but
  currently blocked by macOS Gatekeeper pending a paid Apple Developer ID (see Known Limitations).
- Windows port: Master/Under Device role now computed from real state instead of hardcoded by OS;
  remote local-folder browsing and local-folder Sync Pairs (mirrors the Android implementation);
  full platform-label sweep (no more hardcoded "Mac"/"Finder"/"Touch ID" strings on Windows).
- Android: pairing up to 5 desktop machines simultaneously (previously a single pairing slot,
  silently replaced on re-pair).

### Fixed
- **Security**: the `.dmg` build was shipping the developer's real cloud accounts, device identity,
  and OAuth refresh tokens to every installer built after the first local run. Build order changed
  so the `.dmg`'s source copy is taken from a pristine bundle before any personal runtime state or
  real `.env` is restored into it.
- Runaway `.dmg` size (2.35GB → 129MB) caused by the packaged backend recursively including the
  desktop app's own build output via an npm workspace symlink.
- Device-to-device Share (Mac/Windows ↔ Android/Mac/Windows) was posting to a cloud-backed folder
  route instead of the receiving device's inbox, silently failing depending on which cloud folders
  existed on the target.
- Local folder browsing silently dropped all subdirectories — only the top level of a shared local
  folder was ever visible to a peer.
- Asymmetric device online/offline status on machines with Hyper-V/WSL/VirtualBox/VPN adapters
  installed, caused by a virtual network adapter's IP being reported instead of the real LAN address.
- OAuth callback failures showed a generic "check the backend terminal" message with no visible
  terminal on the packaged app; now surfaces the real provider error inline.
- Android: missing `/local-folders` routes caused "Nothing to sync against on that device yet" when
  adding a Sync Pair against a paired phone.
- macOS menu bar icon click behavior restored to toggle the panel directly (a Windows-only tray
  hover/click split had unintentionally applied to macOS too).

## [v1.0.0] — 2026-08-05

Initial public release. macOS `.dmg` and Android `.apk`.

### Added
- Cloud aggregation across Google Drive, OneDrive, Backblaze B2, IDrive e2, MEGA, and pCloud —
  multiple accounts per provider, combined Files view, Pinned Folders, Trash, cross-cloud search.
- Device pairing over LAN (QR code or USB) between a Mac and an Android phone, with self-healing
  reconnect across network changes.
- Sync Pairs — two-way, backup-only, or download-only sync between a local folder and a cloud
  account, with conflict detection, ignore rules, bandwidth throttling, and a Sync Trash.
- Nearby Share, Continuity (open-on-phone/pick-up-on-Mac), and remote-unlock approval.
- Cross-device search, menu bar/tray quick-access panel with live thumbnails and drag-out.
- Android companion app: cloud browsing, camera/folder backup, Sync Pairs, Nearby Share, App Lock.

---

For the exact commit-level diff behind any release, see the corresponding tag:
[`v1.0.0`](https://github.com/1nonlyvansh/AllieMinate/releases/tag/v1.0.0) ·
[`v2.8.8`](https://github.com/1nonlyvansh/AllieMinate/releases/tag/v2.8.8)
