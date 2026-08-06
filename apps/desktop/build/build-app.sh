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
cp -RL "$ROOT/node_modules" "$APP_RES/backend/node_modules"

# --- restore preserved runtime state (see backup step above) — everything from the previously-installed
# app's backend dir wins outright (folders.json, accounts.json, photos-accounts.json, cache/, etc);
# .env is merged so runtime-written tokens survive but new keys added to the source .env still come through. ---
if [ -d "$PRESERVE_DIR/backend" ]; then
  cp -R "$PRESERVE_DIR/backend/." "$APP_RES/backend/"
fi

# --- shared secrets, same relative depth backend/config.ts expects (Resources/backend/dist/../../../.env == Contents/.env) ---
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

# --- icon + Info.plist ---
cp "$DESKTOP/build/AllieMinate.icns" "$APP_RES/AllieMinate.icns"

/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.alliminate.app" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AllieMinate.icns" "$BUILD_APP/Contents/Info.plist"

echo "== code signing (ad-hoc) =="
# node_modules copied via cp -RL can pick up resource-fork/FinderInfo extended attrs (esp. from
# node-gyp-built native deps) that make codesign fail with "resource fork, Finder information,
# or similar detritus not allowed" — strip them before signing.
xattr -cr "$BUILD_APP"
codesign --force --deep --sign - "$BUILD_APP"

echo "== installing to $INSTALL_DIR =="
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$BUILD_APP" "$INSTALL_DIR/$APP_NAME.app"

# --- distributable .dmg — a real double-click-and-drag-to-Applications installer, built from the same
# freshly-assembled $BUILD_APP the dev install above uses (still valid here, before the EXIT trap wipes
# the staging dir). Runs from a copy in its own empty source folder — create-dmg (and the Finder-scripting
# it does under the hood) gets confused if anything besides the .app and the Applications symlink it adds
# itself is sitting in the source dir. ---
echo "== building AllieMinate.dmg =="
DMG_SRC="$BUILD_STAGING/dmg-src"
mkdir -p "$DMG_SRC"
cp -R "$BUILD_APP" "$DMG_SRC/$APP_NAME.app"
DMG_OUT="$DESKTOP/build/$APP_NAME.dmg"
rm -f "$DMG_OUT"
create-dmg \
  --volname "$APP_NAME" \
  --volicon "$DESKTOP/build/AllieMinate.icns" \
  --window-pos 200 120 \
  --window-size 660 400 \
  --icon-size 100 \
  --icon "$APP_NAME.app" 180 170 \
  --hide-extension "$APP_NAME.app" \
  --app-drop-link 480 170 \
  --no-internet-enable \
  "$DMG_OUT" \
  "$DMG_SRC" \
  || echo "create-dmg exited non-zero (it does this on some harmless Finder-layout races) — checking output anyway"
if [ -f "$DMG_OUT" ]; then
  echo "done: $DMG_OUT"
else
  echo "!! .dmg build failed — dev install above still succeeded, see output for the actual error"
fi

echo "done: $INSTALL_DIR/$APP_NAME.app"
