# Setting up a Sync Pair

A Sync Pair keeps a local folder in sync against either a cloud account or a paired device's own
storage.

## Creating one

1. **Sync → Add Sync Pair**.
2. Pick a local folder.
3. Pick the destination: a connected cloud account/folder, or a paired device's folder (browse and
   create subfolders directly in the picker).
4. Pick a direction:
   - **Two-way** — changes on either side propagate to the other.
   - **Backup-only** — local changes push out; the destination is never written back to the local
     folder.
   - **Download-only** — the destination is the source of truth; local changes are not pushed.
5. Optionally set a bandwidth limit and review the ignore-pattern list (see below).

## Conflict resolution — what actually happens

**Only two-way pairs can have a real conflict** (both sides changed the same file since they were
last confirmed in sync) — backup-only and download-only are one-directional by definition, so there's
nothing to reconcile.

When a real conflict happens, AllieMinate resolves it automatically: **the newer file wins**, and the
older side is renamed to a `<name> (conflict TIMESTAMP).<ext>` copy on its own side rather than
silently overwritten — so you never lose data, but resolution is not currently interactive.

> **Known UI inconsistency**: Settings → Sync Preferences shows a "Conflict resolution" dropdown with
> options *Ask me each time / Keep both versions / Newest wins*. This control is not currently wired
> to anything — actual behavior is always "newest wins, older side kept as a conflict copy" regardless
> of what's selected there. See [Known Issues](../../README.md#known-issues).

## Ignore rules

Sync Pairs skip `.DS_Store`, `.git`, `node_modules`, `.localized`, and `*.tmp` by default. Edit the
pattern list from a Sync Pair's settings — patterns support `*` (any run of characters) and `?` (any
single character), matched against the bare file/folder name at every level of the folder tree, not
the full path.

## Bandwidth throttling

The bandwidth limit set when creating (or editing) a Sync Pair is real and enforced during transfer.

> **Known UI inconsistency**: the separate "Pause sync on metered connection" toggle in Settings →
> Sync Preferences is not currently wired to any real metered-connection detection — toggling it has
> no effect. See [Known Issues](../../README.md#known-issues).

## Sync Trash

Files deleted through a two-way Sync Pair go to a dedicated Sync Trash with a grace period before
permanent deletion, on both sides — a delete doesn't propagate as a hard, immediate, unrecoverable
delete on the other device.

## Pause / resume vs. disable

Pausing a Sync Pair stops it from reconciling without deleting its configuration or history — resume
picks up where it left off. Disabling is the same idea for longer-term "stop syncing this without
forgetting the setup."
