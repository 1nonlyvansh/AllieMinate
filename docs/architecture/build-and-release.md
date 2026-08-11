# Build & release process

This is the real, current process — not an aspirational CI pipeline. There is **no automated
installer-building CI** for any platform yet; every `.dmg`/`.exe`/`.apk` is built manually by the
maintainer and uploaded to GitHub Releases by hand.

## Why CI doesn't build installers (yet)

- `apps/desktop/build/build-app.sh` (the macOS `.dmg`/`.app` build) has hardcoded absolute paths
  pointing at the maintainer's own machine (`ROOT="/Users/.../AllieMinate"`), assembles and ad-hoc
  code-signs a `.app` bundle, and preserves/restores local developer runtime state around the build —
  it is not portable to a clean CI runner as written.
- The Windows `.exe` is built with electron-builder/NSIS on a separate Windows machine; that
  configuration lives outside this repo's automated build path.
- The Android `.apk` released today is a **debug build** (`assembleDebug`, signed with the default
  Android debug keystore). `apps/android/app/build.gradle.kts` has no `signingConfigs` block at all —
  there is no release signing key configured, so `assembleRelease` would currently produce an
  *unsigned* APK, not a distributable one. See [Known Issues](../../README.md#known-issues).
- None of the three installers are code-signed with a paid certificate (Apple Developer ID, a
  Windows code-signing cert, or a Play Store release key), so there's no notarization/signing secret
  CI could even use.

`.github/workflows/ci.yml` and `release.yml` cover what's genuinely automatable today: TypeScript
typechecking, the backend's unit tests, an Android debug compile + unit test pass, and a renderer
build smoke test (catches esbuild/bundle breakage without needing to actually assemble a `.app`).
`release.yml` additionally drafts a GitHub Release with notes pulled from `CHANGELOG.md` when a
`v*.*.*` tag is pushed — but does not attach any installer.

## The manual release process

1. Bump the version in `package.json`, `apps/desktop/package.json`, `apps/backend/package.json`,
   `packages/shared/package.json`, and `apps/android/app/build.gradle.kts` (`versionName` +
   `versionCode`) — all four should always match.
2. Add a section to `CHANGELOG.md` for the new version.
3. Build each installer on its respective platform:
   - **macOS**: `bash apps/desktop/build/build-app.sh` produces `apps/desktop/build/AllieMinate.app`;
     package it as a `.dmg` (the script assembles the app — DMG packaging around it is a separate
     manual step using `hdiutil` or a GUI DMG tool).
   - **Windows**: build with electron-builder/NSIS against the same source tree, on a Windows machine.
   - **Android**: `cd apps/android && ./gradlew assembleDebug` (or a properly configured
     `assembleRelease` once a real signing key exists).
4. Compute SHA-256 checksums for each built artifact (see below) and note them in the release.
5. `git tag vX.Y.Z && git push origin vX.Y.Z` — this triggers `release.yml`, which runs the same
   checks CI does and drafts a GitHub Release from that version's `CHANGELOG.md` section.
6. Manually attach the built `.dmg`, `.exe`, and `.apk` to the drafted release, then publish it.

## Generating checksums

Publish a SHA-256 for every installer so anyone can verify their download wasn't corrupted or
tampered with in transit:

```bash
# macOS / Linux
shasum -a 256 AllieMinate.dmg AllieMinate.apk

# Windows (PowerShell)
Get-FileHash AllieMinate-Setup.exe -Algorithm SHA256
```

Paste the output into the release notes (or a `SHA256SUMS.txt` file attached alongside the
installers) so users can verify with the matching command on their own platform.
