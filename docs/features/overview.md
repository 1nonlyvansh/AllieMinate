# Feature reference

For the full feature list see [README.md](../../README.md#feature-matrix) and the
[compatibility matrix](../../README.md#compatibility-matrix). This page goes one level deeper on the
features that most often raise "wait, how does that actually work?" questions.

## Universal Sync Folder

One cloud login, one host folder on whichever device creates it, broadcast to every paired device
granted access — instead of manually creating a separate Sync Pair leg per device. Under the hood it's
still the same Sync Pair mechanism (hub-and-spoke through the creating "host" device), just orchestrated
across multiple peers at invite time instead of set up by hand on each one. A device that's offline
when the folder is created gets the invite queued and delivered next time it's reachable — the invite
doesn't expire while a device stays unpaired-but-eventually-reconnects.

## Universal Clipboard

Copy text on a paired Mac or Windows machine, paste it on another paired desktop or an Android phone —
**one direction only**, desktop → phone/desktop. Copying on the phone and pasting on a desktop is
**not supported**, and this isn't a bug to be fixed in a future release: Android blocks any app that
isn't the current foreground app or the default keyboard from reading the system clipboard in the
background (a real OS restriction since Android 10). There's no reliable client-side workaround — even
Microsoft's own first-party Phone Link clipboard-sync feature ships the same one-way limitation.

## Nearby Share

Send a file to any AllieMinate device visible on the same network — **paired or not**. The receiving
device gets a real accept/decline prompt; nothing transfers until it's accepted. This is separate from
a Sync Pair: it's a one-off transfer, not an ongoing sync relationship.

## Remote device file browser

For a paired Master's own Sync Pair contents specifically (not its general local folders), both
desktop and Android expose a full browser with Add / Delete / Move / Share actions — not just
read-only browsing.

## Destructive-action authentication

Deleting a Sync Pair requires an explicit confirmation dialog **and** a separate device-authentication
step: Touch ID or the app's own PIN on desktop, biometric or device credential (fingerprint/face/PIN)
on Android. This is independent of whether App Lock itself is turned on — see
[../architecture/security-model.md](../architecture/security-model.md).

## macOS Share Extension

"Share to Connected Devices" / "Add to Cloud Service" extensions are built and installed correctly,
but **macOS Gatekeeper currently refuses to register them** — ad-hoc-signed Share Extensions have no
user-facing override the way a regular app launch does (no "Open Anyway"). This requires a paid Apple
Developer ID to actually ship. Until then, use Nearby Share or a Sync Pair instead of the system share
sheet.
