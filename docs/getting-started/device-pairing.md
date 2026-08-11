# Pairing devices

Pairing establishes a direct LAN connection between two AllieMinate installs — no cloud relay, no
account required on either side, just both devices on the same network (or one tethered to the
other's hotspot).

## Pair a phone to a desktop

1. **Desktop**: Devices → **Pair an Android** — shows a QR code and starts listening for a connection.
2. **Phone**: Devices → **Pair a Device** → scan that QR code (or use the USB fallback below if the
   phone has no working camera/network path to the desktop).
3. Once paired, the phone shows up on the desktop's Devices page with a live online/offline status,
   and the desktop's connected cloud accounts show up in the phone's Cloud Services tab.

A phone can be paired with **up to 5 desktop machines** at once — pairing a new one doesn't replace an
existing pairing.

## Pair two desktops (Mac ↔ Windows, Mac ↔ Mac, etc.)

Same flow — **Devices → Pair a Device** on either machine generates/scans a QR code, or use USB.

## USB pairing (no shared Wi-Fi network)

If the two devices can't reach each other over Wi-Fi (different networks, phone has no camera access
to scan), connect the phone to the computer with a USB cable and use the **Pair via USB** option on
either side's pairing screen instead of scanning a QR code.

## What "paired" actually means

Pairing exchanges a per-device auth token, stored locally on both sides. Every request between paired
devices (file browsing, sync traffic, clipboard, Nearby Share) is authenticated with that token — see
[../architecture/security-model.md](../architecture/security-model.md) for exactly what that does and
doesn't protect against. It is **not** encryption beyond whatever your network already provides.

## If a device shows "Offline" after being paired

AllieMinate re-resolves each paired device's LAN address automatically when its IP changes (waking
from sleep, switching Wi-Fi networks, reconnecting after the desktop tethers to the phone's hotspot).
If a device stays stuck Offline for more than a minute or two on a network both sides can otherwise
reach, see [../troubleshooting/common-issues.md](../troubleshooting/common-issues.md).

## Removing a pairing

- **Desktop**: Devices → the paired device's menu → Unpair.
- **Android**: open the paired device's detail screen → Settings → Unpair. (Unpairing only removes
  that one pairing — a phone paired with multiple desktops keeps the others.)
