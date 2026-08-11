# Security model

This is an honest description of what AllieMinate's security mechanisms actually do, and — just as
importantly — what they don't. See also [SECURITY.md](../../SECURITY.md) for the vulnerability
reporting process.

## No central server, no account system

There's no AllieMinate account, no login, no project-operated backend. Cloud provider credentials
(OAuth tokens, API keys) live only in a local `.env` file / local JSON store on your own machine —
see [../../README.md#developer-setup](../../README.md#developer-setup) and
[../getting-started/cloud-accounts.md](../getting-started/cloud-accounts.md).

## Device pairing tokens

Pairing two devices exchanges a random per-device token, stored locally on both sides
(`apps/backend/src/pairing.ts` on desktop, an equivalent local store on Android). Every subsequent
request between paired devices — file browsing, sync traffic, file transfer, clipboard, Nearby Share —
carries that token and is rejected without it.

**What this protects against**: another device on the same network that was never paired cannot make
authenticated requests to a paired device's local server.

**What this does *not* provide**:
- **No end-to-end encryption of the token or payload beyond normal transport.** Traffic between
  paired devices is plain LAN HTTP today, not TLS. On a network you don't trust (open/hostile Wi-Fi),
  someone capturing traffic on that network could observe pairing tokens and file contents in transit.
  On a normal home/office network this is the same trust boundary most LAN-only tools (Chromecast,
  AirPlay, SMB file sharing) already operate under, but it's not "encrypted like HTTPS," and this
  isn't hidden — it's stated here plainly.
- **A stolen/leaked pairing token is valid until the pairing is explicitly removed.** There's no
  automatic token rotation or expiry once paired.
- **Pairing codes (QR/USB) expire after 5 minutes** if not redeemed, and each is single-use — this
  part is verified real behavior (see `apps/backend/src/pairing.test.ts`), not aspirational.

## App Lock

Optional PIN (all platforms) or Touch ID (macOS) gate on opening the app. This protects the *app UI*
on a device someone already has physical/logged-in access to — it is not disk encryption and does not
protect data at rest if someone has direct filesystem access to your user account.

## Destructive-action authentication

Deleting a Sync Pair requires a confirmation dialog **and** a separate device-authentication check —
Touch ID/app PIN on desktop, Android biometric or device credential (fingerprint/face/PIN, via
`BiometricPrompt` with `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`) on Android — independent of whether
App Lock itself is enabled. Windows currently has no native Windows Hello equivalent wired in yet; it
falls back to the app's own PIN if one is configured, or proceeds without a second gate if neither
Touch ID/Windows Hello nor an app PIN is set up (there's nothing real to authenticate against in that
case — see [../../README.md#known-issues](../../README.md#known-issues)).

## What's genuinely out of scope today

- No end-to-end encryption of LAN traffic (see above).
- No formal third-party security audit has been performed.
- No automated penetration testing or fuzzing in CI.
- Windows Hello is not yet integrated (PIN fallback only).

None of this is hidden to make the project look more finished than it is — see
[../../README.md#known-issues](../../README.md#known-issues) for the full list alongside the
non-security known limitations.
