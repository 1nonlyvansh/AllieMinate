# Troubleshooting

## Installer / first launch

**macOS: "AllieMinate can't be opened because Apple cannot check it for malicious software"**
Expected — the build is unsigned. Right-click → Open, or System Settings → Privacy & Security →
Open Anyway. See [installation/macos.md](../installation/macos.md).

**Windows: "Windows protected your PC" (SmartScreen)**
Expected — the installer is unsigned. Click **More info → Run anyway**. See
[installation/windows.md](../installation/windows.md).

**Android: "App not installed" / blocked install**
Enable **Install unknown apps** for whichever app you downloaded the `.apk` through (browser, Files
app) — Settings → Apps → Special app access → Install unknown apps.

## Device pairing

**A paired device shows Offline even though it's on and reachable**
Most common cause historically: a virtual network adapter (Docker, WSL2, Hyper-V, a VPN client) being
reported as the machine's LAN address instead of its real Wi-Fi/Ethernet IP. This class of bug has
been fixed for the common virtual-adapter naming patterns and IP ranges, but a sufficiently unusual
network setup could still trigger it. Try: reconnecting the device from its own pairing screen, or
disabling an active VPN and re-checking.

**Pairing QR code doesn't scan / times out**
Pairing codes expire after 5 minutes — generate a fresh QR code and scan promptly. If the phone and
desktop are on genuinely different networks (e.g. phone on cellular, desktop on home Wi-Fi with no
hotspot), pairing can't succeed over LAN — use USB pairing instead, or put both on the same network.

**"Nothing to sync against on that device yet" when adding a Sync Pair against a paired device**
This should show that device's real folders. If it doesn't, confirm both devices are on the current
release — this was a real bug (Android's local-folder listing route was missing) fixed in v2.8.8.

## Sync

**A file shows as a "(conflict TIMESTAMP)" copy**
Expected behavior, not an error — see [../getting-started/sync-configuration.md](../getting-started/sync-configuration.md#conflict-resolution--what-actually-happens).
Both versions of the file are preserved; nothing was lost.

**The "Conflict resolution" dropdown or "Pause sync on metered connection" toggle in Settings doesn't
seem to do anything**
Correct, currently — neither is wired to real logic yet. See
[Known Issues](../../README.md#known-issues). Actual conflict behavior is always "newest wins, older
copy preserved"; bandwidth limiting (the separate control) is real and does work.

## Universal Clipboard

**Copying on my phone doesn't paste on my Mac/PC**
Not currently supported in that direction — see
[../features/overview.md#universal-clipboard](../features/overview.md#universal-clipboard). Desktop →
phone/desktop works; phone → desktop is an Android platform limitation, not a missing feature to
request.

## macOS Share Extension

**"Share to Connected Devices" doesn't show up in the macOS Share menu / System Settings → Extensions**
Expected on the current unsigned build — see
[../features/overview.md#macos-share-extension](../features/overview.md#macos-share-extension). Use
Nearby Share or a Sync Pair in the meantime.

## Still stuck?

Check [open issues](https://github.com/1nonlyvansh/AllieMinate/issues), or open a new one with the
[bug report template](https://github.com/1nonlyvansh/AllieMinate/issues/new?template=bug_report.md) —
include your platform, AllieMinate version, and exact repro steps.
