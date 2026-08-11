# Installing AllieMinate on Android

## Requirements

- Android 8.0 (API 26) or newer
- Same Wi-Fi network as the Mac/Windows PC you'll pair with (or that PC tethered to your phone's own
  hotspot)

## Install the `.apk`

1. Download `AllieMinate.apk` from the [latest release](https://github.com/1nonlyvansh/AllieMinate/releases/latest)
   directly on your phone (or transfer it over after downloading on a computer).
2. Open the downloaded file. If this is your first APK installed outside the Play Store, Android will
   prompt to allow installs from that source (browser, Files app, etc.) — **Settings → Apps → Special
   app access → Install unknown apps**, enable it for whichever app you downloaded through.
3. Confirm the install.

AllieMinate is not published on the Google Play Store — sideloading the `.apk` is the only
distribution method right now.

## First-launch permissions

The app will ask for storage/media/notification permissions as you use features that need them
(camera backup, file browsing by category, transfer notifications). Grant them individually as
prompted — declining one only disables that specific feature, not the whole app.

## Pairing with a desktop

See [../getting-started/device-pairing.md](../getting-started/device-pairing.md).

## Uninstalling / resetting

- **Uninstall**: long-press the AllieMinate icon → **Uninstall**, or **Settings → Apps → AllieMinate →
  Uninstall**.
- **Full reset without uninstalling** (clears paired devices, Sync Pairs, cached settings):
  **Settings → Apps → AllieMinate → Storage & cache → Clear storage**.

## Building from source instead

See [../../README.md#developer-setup](../../README.md#developer-setup).
