# Contributing to AllieMinate

Thanks for considering a contribution. AllieMinate is a single-maintainer project, so response times
vary, but real issues and PRs get reviewed.

## Before you start

- For anything beyond a small fix (typo, obvious bug, docs), open an issue first to discuss the
  approach — this saves you from building something that doesn't fit the project's direction.
- Check existing issues and the [Roadmap](README.md#roadmap) so you're not duplicating work already
  in progress.
- Read [ARCHITECTURE.md / docs/architecture](docs/architecture/) first if you're touching sync,
  pairing, or the backend — those subsystems have real invariants that aren't always obvious from
  the code alone.

## Project layout

```
apps/
  backend/    Fastify server — talks to every cloud provider and every paired device.
  desktop/    Electron + React — the macOS/Windows app.
  android/    Kotlin + Jetpack Compose — the phone app.
  website/    Astro static site (apps/website) — builds to static HTML/CSS/JS.
packages/
  shared/     TypeScript types shared between backend and desktop.
```

## Development setup

See [README.md → Developer Setup](README.md#developer-setup) for the full clone/install/build flow
for desktop and Android. Short version:

```bash
git clone https://github.com/1nonlyvansh/AllieMinate.git
cd AllieMinate
npm install
cp .env.example .env   # fill in whichever cloud provider(s) you're testing against
bash apps/desktop/build/build-app.sh
```

## Coding conventions

- **TypeScript** (backend/desktop): match the existing style in the file you're editing. Run
  `npx tsc --noEmit -p apps/backend/tsconfig.json` / `apps/desktop/tsconfig.json` before opening a
  PR — CI runs the same check.
- **Kotlin** (Android): match the existing Compose patterns already in `ui/screens/` and
  `ui/components/`. Run `./gradlew compileDebugKotlin` from `apps/android` before opening a PR.
- Don't add abstractions, config flags, or "future-proofing" for a use case the PR doesn't need —
  keep changes scoped to the problem being solved.
- Comment the *why*, not the *what* — the existing codebase leans on this heavily (see any storage
  backend or the sync engine for examples); a comment explaining a non-obvious constraint is welcome,
  a comment restating the code below it is not.
- No secrets, real account data, or personal device identifiers in commits, fixtures, or test data —
  see [SECURITY.md](SECURITY.md) for what's sensitive.

## Tests

- Backend: `npm test --workspace=@alliminate/backend` (Vitest). New pure-logic modules (sync
  decision logic, conflict resolution, ignore rules, token/pairing validation, etc.) should ship
  with real tests — assert actual behavior, not just that a mock was called.
- Android: `./gradlew test` for JVM unit tests. UI/instrumented tests are not yet set up — see
  [Known Issues](README.md#known-issues) if you want to help with that.
- Test coverage is genuinely incomplete right now (see the CI workflow for exactly what runs) —
  expanding it is a welcome contribution on its own, not just a requirement attached to feature PRs.

## Pull requests

1. Fork, branch off `main`, keep the PR focused on one change.
2. Fill out the PR template — it asks what changed, why, and how you tested it.
3. Make sure CI is green (typecheck + Android compile + tests).
4. Update `README.md` / `CHANGELOG.md` / `docs/` if your change affects documented behavior — a PR
   that changes shipped functionality without touching docs will get asked to add that.

## Reporting bugs / requesting features

Use the issue templates (`.github/ISSUE_TEMPLATE/`) — they ask for the platform, version, and repro
steps that actually get a bug fixed faster.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report violations to
[vansh080605@gmail.com](mailto:vansh080605@gmail.com).

## License

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
