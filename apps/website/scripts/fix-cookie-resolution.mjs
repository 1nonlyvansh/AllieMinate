// Workaround for a real npm-workspaces hoisting conflict: the backend's Fastify dependency
// chain pulls in cookie@0.7.2 (CJS, `parse`/`serialize` API), which npm hoists to the repo
// root's node_modules/cookie — occupying that name before astro's own cookie@2.0.1 (ESM,
// `parseCookie`/`stringifySetCookie` API) can claim it, so npm nests astro's copy instead at
// node_modules/astro/node_modules/cookie. Plain Node resolution from files inside astro's own
// package would find that nested copy fine, but `astro build`'s Vite-based SSR bundling step
// resolves bare `cookie` imports relative to the Vite project root (this workspace,
// apps/website) — which has no node_modules of its own, so resolution climbs straight to the
// repo root and picks up the wrong (0.7.2, CJS) version, hard-failing the build with
// "Named export 'parseCookie' not found".
//
// Forcing a single cookie version repo-wide (an npm "overrides" entry) isn't safe here: it
// would either break Fastify's cookie usage or astro's, since 0.7.x and 2.x are different
// APIs. Instead, this copies astro's own already-correct nested copy into
// apps/website/node_modules/cookie, which Vite's root-relative resolver checks BEFORE
// climbing to the repo root — fixing resolution without touching the backend's dependency at
// all. Runs as a postinstall so it self-heals after every `npm install`.
import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(websiteDir));

const source = join(repoRoot, 'node_modules', 'astro', 'node_modules', 'cookie');
const dest = join(websiteDir, 'node_modules', 'cookie');

if (existsSync(source) && !existsSync(dest)) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true });
  console.log('[fix-cookie-resolution] Copied astro\'s cookie@2.x into apps/website/node_modules for Vite resolution.');
}
