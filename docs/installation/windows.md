# Installing AllieMinate on Windows

## Requirements

- Windows 10 or 11 (64-bit)
- ~200MB free disk space

## Install from the `.exe`

1. Download `AllieMinate-Setup.exe` (or similarly named installer) from the
   [latest release](https://github.com/1nonlyvansh/AllieMinate/releases/latest).
2. Run the installer and follow the setup wizard.
3. Launch AllieMinate from the Start Menu or desktop shortcut it creates.

## First launch: the SmartScreen warning

Like the macOS build, the Windows installer is **not signed with a paid code-signing certificate**.
Windows SmartScreen will likely show "Windows protected your PC" on first run. To proceed:

- Click **More info**, then **Run anyway**.

This is a one-time warning per install, not a sign anything is wrong with the download — just an
unsigned binary, the same tradeoff as the macOS Gatekeeper prompt above.

## Uninstalling / resetting

- **Uninstall**: **Settings → Apps → Installed apps** → find AllieMinate → **Uninstall**.
- **Full reset** (also clears paired devices, linked cloud accounts, and Sync Pair configuration):
  additionally delete `%APPDATA%\AllieMinate\` (paste that path into File Explorer's address bar).

## Building from source instead

See [../../README.md#developer-setup](../../README.md#developer-setup). The backend and renderer are
the same cross-platform TypeScript/Electron source tree used on macOS — no Windows-specific source
changes are needed to build, only a Windows machine to build and package on.
