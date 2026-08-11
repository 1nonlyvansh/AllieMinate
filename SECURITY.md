# Security Policy

## Supported versions

AllieMinate is a single-maintainer, actively-developed project. Only the **latest released
version** (currently v2.8.9 — see [CHANGELOG.md](CHANGELOG.md)) receives security fixes. There is
no long-term support branch and no backporting of fixes to older releases.

## Reporting a vulnerability

If you find a security issue in AllieMinate — in the desktop app, the Android app, the backend, or
the pairing/sync protocol between devices — please report it privately rather than opening a public
GitHub issue.

**Email:** [vansh080605@gmail.com](mailto:vansh080605@gmail.com)

Include:
- A description of the issue and its impact.
- Steps to reproduce (platform, version, and exact repro if possible).
- Any relevant logs — **redact tokens, account emails, and device identifiers first.**

This is a solo-maintained open-source project, not a company with a formal security team: there is
no bug bounty program and no guaranteed response SLA, but real reports will be read and acted on. If
you don't hear back within a couple of weeks, a follow-up email is welcome.

Please give a reasonable amount of time to investigate and patch a report before disclosing it
publicly.

## What's in scope

- The Electron desktop app (`apps/desktop`) and its local Fastify backend (`apps/backend`).
- The Android app (`apps/android`).
- The LAN pairing/auth protocol between devices.
- Cloud provider credential handling (OAuth token storage, `.env` handling).

## What's out of scope

- Vulnerabilities in third-party cloud providers themselves (Google Drive, OneDrive, MEGA, pCloud,
  Backblaze B2, IDrive e2) — report those to the provider directly.
- Social engineering, physical access to an unlocked device, or attacks that require the attacker to
  already control one of the paired devices.
- The marketing website in `apps/website` (static, no backend, no user data).

## How AllieMinate handles your data — honestly

- **There is no AllieMinate-operated server.** Cloud calls go directly from your machine to each
  provider's own API using credentials you supply; device-to-device features (pairing, sync, file
  transfer, clipboard, Nearby Share) run entirely over your local network. Nothing about your files
  or account credentials passes through infrastructure the project operates, because none exists.
- OAuth client secrets and refresh tokens live in a local `.env` file (see `.env.example`), which is
  `.gitignore`d and never intended to be committed or shared. Every cloud provider, including Google
  Drive, currently requires the user to supply their own OAuth client credentials — there is no
  default/shared client baked into the app.
- Paired-device communication is authenticated with a per-device token exchanged at pairing time;
  it is not (yet) end-to-end encrypted beyond whatever transport security your OS/network already
  provides — see [docs/architecture/security-model.md](docs/architecture/security-model.md) for the
  current honest threat model.
- App Lock (Touch ID/PIN on desktop, biometric/device-credential on Android) protects the app UI and
  gates destructive actions (like deleting a Sync Pair) locally on-device; it is not a substitute for
  full-disk encryption or OS-level account security.

## Known dependency vulnerabilities (as of v2.8.8)

`npm audit` currently reports 8 findings (3 high, 5 moderate), all in transitive dependencies of
`electron`, `fastify`, and `googleapis`. None are fixable via `npm audit fix` without a **major**
version bump of the top-level package (Electron 33→43, Fastify 4→5) — those are real behavior
changes to the app runtime, not something to force silently as part of a documentation/hygiene pass.
They're tracked, not hidden:

- **Electron 33.x** has several fixed-in-later-releases advisories (ASAR integrity, IPC spoofing,
  use-after-free classes). Upgrading to 43.x is a deliberate follow-up, not done here.
- **Fastify 4.x** → the fix line is 5.x, a breaking API change for route/plugin registration used
  throughout `apps/backend`.
- **googleapis** pulls in a `uuid` version with a moderate advisory; the fix requires bumping
  `googleapis` to a new major.

Dependabot (`.github/dependabot.yml`) will open PRs for these on its own schedule; `npm audit
--audit-level=high` runs in CI as an informational (non-blocking) step so new findings are visible
without gating every PR on pre-existing, already-tracked ones.

## Known, already-documented limitations

These are not secret — they're called out here and in the README so nobody mistakes them for
undiscovered bugs:
- Universal Clipboard only syncs desktop → phone/desktop, never phone → desktop, due to an Android
  OS restriction on background clipboard access (not something a client-side fix can work around).
- The macOS Share Extension is built but not currently enabled — Gatekeeper refuses to register an
  ad-hoc-signed Share Extension, and there's no user-facing override for that (unlike a normal app
  launch). It requires a paid Apple Developer ID to ship.
- There is no automated dependency vulnerability scanning in CI yet beyond Dependabot version PRs —
  run `npm audit` locally before relying on this in a sensitive environment.
