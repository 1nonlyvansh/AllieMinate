# Missing / deferred information

Honest list of what this rebuild could not verify, fabricate, or finish — per the build prompt's
own "do not invent" rule. Nothing below was silently worked around.

## Resolved: Windows `.exe` now on GitHub Releases

Originally flagged here as missing — since fixed. The `v1.0.0`-tagged release (display title
"v2.8.8 (.apk, .exe. .dmg Installers)") now has a real `AllieMinate.Setup.0.1.0.exe` asset
attached. The Windows download button links directly to it via
`releases/latest/download/AllieMinate.Setup.0.1.0.exe`, verified to resolve, same pattern as
macOS/Android.

Note the asset's own filename still says `0.1.0` (a stale version number baked into the
installer at build time, before this repo's version-consistency fix landed on the Windows build
side) — cosmetic, doesn't affect the download working, but worth a real `2.8.8`-versioned
rebuild next time the Windows installer gets rebuilt.

The repo still has a separate git tag `v2.8.8` (pushed in an earlier session) with **no GitHub
Release created for it** — no release page, no assets. Not blocking anything today since
`releases/latest` correctly resolves to the `v1.0.0`-tagged release that actually has installers,
but worth tidying up (either attach assets to a real `v2.8.8` release, or delete the empty tag)
so `git tag` and "latest GitHub Release" agree with each other.
the `v2.8.8` tag with all three assets and retire/relabel the mislabeled `v1.0.0` one. Until then,
a visitor clicking "Get the installer" for Windows lands on the releases page and has to find the
right thing themselves — there's currently nothing better to link to honestly.

## Screenshots — none exist, none were fabricated

Per the "what Claude must not invent" list, no product screenshots were created. The design uses
hand-authored SVG line-art device illustrations (Mac/Windows/Android outlines) instead of real UI
screenshots anywhere a screenshot would normally go. If/when real screenshots exist, the natural
places to add them are the three Platform cards (`PlatformCard.astro`) and the Hero visual.

## Social preview image

An OG image (`public/images/og-hero.png`, 1200×630, real composition of the actual logo + actual
tagline, rasterized from the real `icon-source.svg`) is wired into `og:image`/`twitter:image` meta
tags. GitHub's separate repo-level "social preview image" (Settings → General → Social preview) is
a different thing that has to be uploaded through the GitHub web UI — not something `gh` CLI or
this codebase can set. Recommend uploading the same `og-hero.png` there by hand.

## GitHub stars/forks/issues counters

The prompt listed this as optional ("via API or static"). Not implemented — a live counter would
need a client-side fetch to the GitHub API at page-load (subject to GitHub's unauthenticated rate
limits) or a build-time fetch (would go stale between deploys without a rebuild webhook). Skipped
rather than build something that either rate-limits real visitors or silently goes stale.

## favicon.ico

Generated for real via `sips -s format ico` from the actual logo (not the Astro scaffold's
placeholder) — but it's a single 32×32 frame, not a true multi-resolution `.ico` (16/32/48 in one
file), since no ImageMagick/similar was available in this environment to build a proper multi-res
ICO. Every modern browser uses the SVG/PNG `<link rel="icon">` entries instead and ignores
`favicon.ico` entirely, so this only matters for very old IE — low priority to revisit.

## Screenshot-based visual QA was incomplete for scrolled content

The in-session browser preview tool could reliably screenshot the page at scroll position 0 (hero)
on both desktop and mobile viewports, and those renders were reviewed and look correct. Screenshots
taken after scrolling — via wheel-scroll, direct `window.scrollTo`, and the tool's own
`scroll_to`-into-view helper alike — consistently returned a blank frame for the rest of this
session, independent of any site code (confirmed by disabling `backdrop-filter` entirely, which
didn't change the result). The DOM, computed styles, and full text content of every section below
the fold were verified directly instead (accessibility tree via `read_page`, full text via
`get_page_text`, and targeted `getComputedStyle`/`getBoundingClientRect` checks) — everything
inspected that way was correct — but this is a real gap: nobody has visually eyeballed a screenshot
of the Sync/Security/Platforms/Download/Feature Explorer/GitHub/Final CTA sections or the Privacy
and Terms pages. Worth a manual look in a normal browser before treating the design as fully
signed off.

## Lighthouse CI

Not run — no Lighthouse CLI/Chrome-launcher setup exists in this environment, and installing one
for a one-off check felt like scope creep beyond what was asked. `npm run build` succeeds cleanly,
core page weight is ~468KB (HTML+CSS+JS+images actually loaded on a page view, excluding the
OG-crawler-only hero image), and system fonts / no web-font downloads keep FOUT/FOIT non-issues by
construction — but no actual Lighthouse score was measured.

## `apps/website/node_modules/cookie` self-heal script

`scripts/fix-cookie-resolution.mjs` (wired as this workspace's `postinstall`) works around a real
npm-workspaces hoisting conflict between the backend's `fastify → cookie@0.7.2` (CJS) and astro's
own `cookie@2.0.1` (ESM) — full explanation is in the script's own comment and in the final report.
Flagging here too since it's an unusual thing to find in a fresh clone and worth knowing about if
it ever needs to be removed (e.g. if a future Astro version stops depending on `cookie`, or ships a
version that hoists cleanly).
