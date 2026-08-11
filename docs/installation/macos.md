# Installing AllieMinate on macOS

## Requirements

- macOS (Apple Silicon or Intel)
- ~200MB free disk space

## Install from the `.dmg`

1. Download `AllieMinate.dmg` from the [latest release](https://github.com/1nonlyvansh/AllieMinate/releases/latest).
2. Open the `.dmg` and drag **AllieMinate** onto the **Applications** shortcut.
3. Open AllieMinate from Applications or Launchpad.

## First launch: the Gatekeeper warning

AllieMinate is **not notarized with a paid Apple Developer certificate** — this is not a bug, it's the
real cost of code-signing on macOS, and the project is currently unsigned. The first launch will be
blocked by Gatekeeper ("AllieMinate can't be opened because Apple cannot check it for malicious
software" or similar). To get past it, **once**:

- Right-click (or Control-click) **AllieMinate.app** in Applications → **Open** → confirm **Open** in
  the dialog that appears, **or**
- **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to the AllieMinate
  block notice.

You only need to do this once per install. After that it opens normally like any other app.

## First-launch permissions

macOS will separately prompt for Desktop/Documents/Downloads folder access the first time AllieMinate
tries to read from them (for Sync Pairs, local-folder browsing, etc.) — grant these individually as
they come up, or the corresponding folder just won't be browsable.

## Uninstalling / resetting

- **Uninstall**: quit AllieMinate, drag `AllieMinate.app` from Applications to the Trash.
- **Full reset** (also clears paired devices, linked cloud accounts, and Sync Pair configuration):
  additionally delete `~/Library/Application Support/AllieMinate/`. This is a normal user directory —
  no admin/root access needed, and nothing about it is hidden from Finder's "Go to Folder" (`⌘⇧G`).

## Building from source instead

See [../../README.md#developer-setup](../../README.md#developer-setup).
