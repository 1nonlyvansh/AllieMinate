## What changed

<!-- Describe the change. Link the issue it fixes/addresses if there is one. -->

## Why

<!-- What problem does this solve? Skip if the linked issue already covers it. -->

## Platform(s) affected

- [ ] macOS
- [ ] Windows
- [ ] Android
- [ ] Backend (shared across desktop platforms)
- [ ] Docs only

## How was this tested?

<!-- What you actually ran: `npx tsc --noEmit`, `./gradlew compileDebugKotlin`, manual testing on
a real device, new/updated automated tests, etc. Be specific — "tested" alone doesn't tell a
reviewer anything. -->

## Checklist

- [ ] `npx tsc --noEmit -p apps/backend/tsconfig.json` and `apps/desktop/tsconfig.json` pass (if TS changed)
- [ ] `./gradlew compileDebugKotlin` passes (if Android changed)
- [ ] Relevant tests added/updated, or an explanation of why none apply
- [ ] README / CHANGELOG / docs updated if this changes documented behavior
- [ ] No secrets, real account data, or personal device identifiers included in this diff
