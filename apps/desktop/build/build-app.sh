#!/bin/bash
set -euo pipefail

ROOT="/Users/vanshkishore/Desktop/Projects/AllieMinate"
DESKTOP="$ROOT/apps/desktop"
BACKEND="$ROOT/apps/backend"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
APP_NAME="AllieMinate"
BUILD_STAGING="$(mktemp -d)"
BUILD_APP="$BUILD_STAGING/$APP_NAME.app"
INSTALL_DIR="$HOME/Applications"
trap 'rm -rf "$BUILD_STAGING"' EXIT

INSTALLED_APP="$INSTALL_DIR/$APP_NAME.app"
PRESERVE_DIR="$BUILD_STAGING/preserve"
mkdir -p "$PRESERVE_DIR"

# --- preserve ALL runtime state (linked accounts, folders, cache, OAuth tokens — anything the app writes
# at runtime) across rebuilds — the app writes these INTO the installed bundle, which gets replaced
# wholesale below. Generic (not a hardcoded filename list) so a NEW runtime-state file added later can't
# silently get wiped by a rebuild the way accounts.json/photos-accounts.json already did once each. Only
# dist/ and node_modules/ are excluded since those always come fresh from source. ---
if [ -d "$INSTALLED_APP/Contents/Resources/backend" ]; then
  mkdir -p "$PRESERVE_DIR/backend"
  find "$INSTALLED_APP/Contents/Resources/backend" -maxdepth 1 -mindepth 1 \
    ! -name dist ! -name node_modules \
    -exec cp -R {} "$PRESERVE_DIR/backend/" \;
fi
if [ -f "$INSTALLED_APP/Contents/.env" ]; then
  cp "$INSTALLED_APP/Contents/.env" "$PRESERVE_DIR/.env"
fi

echo "== rebuilding sources =="
(cd "$ROOT/packages/shared" && npx tsc -p tsconfig.json)
(cd "$BACKEND" && npx tsc -p tsconfig.json)
(cd "$DESKTOP" && npx tsc -p tsconfig.json)
(cd "$DESKTOP" && npx esbuild src/renderer/index.tsx --bundle --outfile=src/renderer/bundle.js --loader:.tsx=tsx --loader:.png=dataurl --jsx=automatic)
(cd "$DESKTOP" && npx esbuild src/renderer/trayPanelIndex.tsx --bundle --outfile=src/renderer/trayPanel-bundle.js --loader:.tsx=tsx --loader:.png=dataurl --jsx=automatic)

echo "== assembling $APP_NAME.app =="
rm -rf "$BUILD_APP"
cp -R "$ELECTRON_APP" "$BUILD_APP"

APP_RES="$BUILD_APP/Contents/Resources"
APP_CONTENT="$APP_RES/app"

# --- desktop app content (main/preload/renderer) ---
mkdir -p "$APP_CONTENT/dist" "$APP_CONTENT/src/renderer"
cp -R "$DESKTOP/dist/." "$APP_CONTENT/dist/"
cp "$DESKTOP/src/renderer/index.html" "$APP_CONTENT/src/renderer/"
cp "$DESKTOP/src/renderer/bundle.js" "$APP_CONTENT/src/renderer/"
cp "$DESKTOP/src/renderer/trayPanel.html" "$APP_CONTENT/src/renderer/"
cp "$DESKTOP/src/renderer/trayPanel-bundle.js" "$APP_CONTENT/src/renderer/"
cp -R "$DESKTOP/src/renderer/styles" "$APP_CONTENT/src/renderer/styles"
cp -R "$DESKTOP/assets" "$APP_CONTENT/assets"

cat > "$APP_CONTENT/package.json" << 'EOF'
{
  "name": "alliminate-desktop-app",
  "private": true,
  "main": "dist/main/index.js"
}
EOF

# --- backend, self-contained with its own node_modules ---
mkdir -p "$APP_RES/backend"
cp -R "$BACKEND/dist" "$APP_RES/backend/dist"
cp "$BACKEND/folders.json" "$APP_RES/backend/folders.json"
echo "== copying node_modules (this takes a bit) =="
# excludes packages the backend (a plain Node child process, no Electron API access — see spawnBackend)
# never actually imports: electron itself (245MB — the backend runs under Electron's bundled Node via
# child_process, it doesn't need its OWN copy of the whole Electron.app framework sitting in
# node_modules/electron/dist) plus pure build-time tooling (typescript/esbuild/@types, ~35MB, nothing but
# .ts source and dev scripts ever reference them, and dist/ is already-compiled plain .js). This was the
# single biggest contributor to a 2GB+ DMG — cutting it roughly in half — which in turn was the real cause
# behind an hour-plus install time on a fresh Mac: macOS's Gatekeeper quarantine scan runs across every
# file in a freshly-downloaded, unnotarized .app on first copy, so a smaller bundle is a faster install,
# not just a smaller download.
rsync -aL \
  --exclude 'electron' \
  --exclude 'typescript' \
  --exclude 'esbuild' \
  --exclude '@esbuild' \
  --exclude '@types' \
  --exclude '@alliminate/desktop' \
  "$ROOT/node_modules/" "$APP_RES/backend/node_modules/"

# --- icon + Info.plist ---
cp "$DESKTOP/build/AllieMinate.icns" "$APP_RES/AllieMinate.icns"

/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.alliminate.app" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AllieMinate.icns" "$BUILD_APP/Contents/Info.plist"

# $BUILD_APP is PRISTINE at this point — no accounts, no device identity, no cloud credentials, nothing
# any previous install ever wrote. That's deliberate: this exact bundle is what both the .dmg AND (after
# this section) the personalized dev install get built from, and the .dmg copy is taken further down
# BEFORE any personal state gets restored into it. A prior version of this script restored preserved
# state (accounts.json, device.json, username.json, the real .env with live OAuth refresh tokens for
# every connected provider — everything) into $BUILD_APP and THEN copied that same personalized bundle
# into the .dmg, meaning every .dmg this script built after the first run shipped the developer's own
# Google Drive/MEGA/etc credentials and identity to whoever installed it. Ship blank .env.example
# placeholders here — config.ts already runs fine with everything empty (README's own "fresh clone" setup
# path is exactly this: cp .env.example .env, fill in only what you want).
cp "$ROOT/.env.example" "$BUILD_APP/Contents/.env"

echo "== code signing (ad-hoc) =="
# node_modules copied via cp -RL can pick up resource-fork/FinderInfo extended attrs (esp. from
# node-gyp-built native deps) that make codesign fail with "resource fork, Finder information,
# or similar detritus not allowed" — strip them before signing.
xattr -cr "$BUILD_APP"
codesign --force --deep --sign - "$BUILD_APP"

# --- distributable .dmg — a real double-click-and-drag-to-Applications installer, built from the PRISTINE
# signed $BUILD_APP above, copied to its own empty source folder BEFORE any personal state gets restored
# into $BUILD_APP for the dev install further down. create-dmg (and the Finder-scripting it does under the
# hood) gets confused if anything besides the .app and the Applications symlink it adds itself is sitting
# in the source dir. ---
echo "== building AllieMinate.dmg =="
DMG_SRC="$BUILD_STAGING/dmg-src"
mkdir -p "$DMG_SRC"
cp -R "$BUILD_APP" "$DMG_SRC/$APP_NAME.app"

# Not notarized (no paid Apple Developer cert) — the FIRST launch on any Mac other than the one that built
# it gets Gatekeeper's "AllieMinate Not Opened" block, and clicking "Done" on that dialog just dismisses it
# without granting the exception, leaving the app permanently unopenable with no further prompt. This was
# already documented in the README, which nobody installing FROM a .dmg a friend sent them is ever going to
# go read — so it's a plain text file sitting right next to the app in the .dmg itself instead. Explicitly
# positioned (see the --icon flag below) since create-dmg's Finder-layout AppleScript only reliably arranges
# icons it's told about; an unpositioned stray file in the source folder is what causes the "Finder layout
# race" create-dmg sometimes exits non-zero on.
cat > "$DMG_SRC/If AllieMinate Won't Open.txt" << 'EOF'
AllieMinate isn't notarized with a paid Apple Developer certificate, so macOS
Gatekeeper blocks the very first launch with a warning ("Apple could not
verify..."). This is normal for a free, independently-built app — it does NOT
mean anything is wrong with it.

Clicking "Done" on that warning does NOT open the app. Do this instead:

  1. Open System Settings -> Privacy & Security.
  2. Scroll down to the Security section — you'll see a line about
     "AllieMinate was blocked."
  3. Click "Open Anyway", then confirm in the popup that appears.

(Or: right-click AllieMinate.app in Applications -> Open -> Open, BEFORE
ever double-clicking it the normal way — this only works if it's the very
first launch attempt.)

You only need to do this once.
EOF

DMG_OUT="$DESKTOP/build/$APP_NAME.dmg"
rm -f "$DMG_OUT"
create-dmg \
  --volname "$APP_NAME" \
  --volicon "$DESKTOP/build/AllieMinate.icns" \
  --window-pos 200 120 \
  --window-size 660 400 \
  --icon-size 100 \
  --icon "$APP_NAME.app" 180 170 \
  --icon "If AllieMinate Won't Open.txt" 330 280 \
  --hide-extension "$APP_NAME.app" \
  --app-drop-link 480 170 \
  --no-internet-enable \
  "$DMG_OUT" \
  "$DMG_SRC" \
  || echo "create-dmg exited non-zero (it does this on some harmless Finder-layout races) — checking output anyway"
if [ -f "$DMG_OUT" ]; then
  echo "done: $DMG_OUT"
else
  echo "!! .dmg build failed — see output for the actual error (dev install below is unaffected)"
fi

# --- personalize $BUILD_APP for the LOCAL dev install only, now that the pristine .dmg copy is already
# safely taken above — restore preserved state (accounts.json, device.json, username.json, folders.json,
# cache/, etc — everything from the previously-installed app's own backend dir) and the real .env with
# live OAuth tokens. Re-signs afterward since the bundle's contents just changed post-signature. ---
echo "== personalizing dev install =="
if [ -d "$PRESERVE_DIR/backend" ]; then
  cp -R "$PRESERVE_DIR/backend/." "$APP_RES/backend/"
fi

# same relative depth backend/config.ts expects (Resources/backend/dist/../../../.env == Contents/.env)
if [ -f "$PRESERVE_DIR/.env" ]; then
  node -e '
    const fs = require("fs");
    function parse(text) {
      const out = new Map();
      for (const line of text.split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) out.set(m[1], m[2]);
      }
      return out;
    }
    const sourceText = fs.readFileSync(process.argv[1], "utf-8");
    const runtime = parse(fs.readFileSync(process.argv[2], "utf-8"));
    const merged = sourceText.split("\n").map((line) => {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) return line;
      const [, key] = m;
      const runtimeVal = runtime.get(key);
      return runtimeVal ? `${key}=${runtimeVal}` : line;
    }).join("\n");
    fs.writeFileSync(process.argv[3], merged);
  ' "$ROOT/.env" "$PRESERVE_DIR/.env" "$BUILD_APP/Contents/.env"
else
  cp "$ROOT/.env" "$BUILD_APP/Contents/.env"
fi

xattr -cr "$BUILD_APP"
codesign --force --deep --sign - "$BUILD_APP"

echo "== installing to $INSTALL_DIR =="
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$BUILD_APP" "$INSTALL_DIR/$APP_NAME.app"

echo "done: $INSTALL_DIR/$APP_NAME.app"
