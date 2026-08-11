# Connecting a cloud account

AllieMinate itself ships with no cloud credentials built in — every provider needs your own OAuth
app/API keys, entered once, stored locally.

## Desktop (macOS/Windows)

1. **Settings → Cloud Services** (or the empty-state "Connect a Cloud" button on the Cloud Services
   page).
2. Pick a provider and follow its connect flow:
   - **Google Drive / OneDrive** — opens a browser OAuth consent screen; approve it, the tab closes
     itself back to AllieMinate.
   - **Backblaze B2 / IDrive e2** — paste in an endpoint, region, bucket, and access key pair from that
     provider's dashboard.
   - **pCloud** — OAuth consent screen, same as Drive/OneDrive.
   - **MEGA** — enter your MEGA account email/password directly (MEGA has no OAuth flow).
3. Once connected, the account shows up in **Cloud Services** and in the combined **Files** view.

You can connect **multiple accounts of the same provider** (e.g. two separate Google Drive logins) —
each shows up as its own entry, individually renameable and removable from **Settings**.

## Where credentials actually live

Every provider's client ID/secret (for the ones that need one) comes from your own `.env` — see
[../../README.md#developer-setup](../../README.md#developer-setup) if you're building from source, or
the desktop app's Settings screen if you're using a packaged build. Per-account tokens (OAuth refresh
tokens, MEGA session state) are written to a local JSON store inside AllieMinate's own app-data
directory — see [../architecture/security-model.md](../architecture/security-model.md) — never synced
anywhere, never sent to a project-operated server (there isn't one).

## Android

The phone app does not hold its own cloud credentials — it browses whatever accounts are connected on
a **paired desktop**, proxied over the LAN connection established during pairing. Connect accounts on
the desktop first, then pair the phone (see [device-pairing.md](device-pairing.md)).
