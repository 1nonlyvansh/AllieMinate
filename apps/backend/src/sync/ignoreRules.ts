import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../paths';

// Same defaults twoWaySync.ts hardcoded before this file existed — kept as the seed list rather than
// dropped, so upgrading doesn't suddenly start syncing .git or node_modules for existing Auto-Sync folders.
const DEFAULT_RULES = ['.DS_Store', '.git', 'node_modules', '.localized', '*.tmp'];

const RULES_PATH = dataPath('syncIgnoreRules.json');

export function loadIgnoreRules(): string[] {
  if (!fs.existsSync(RULES_PATH)) return DEFAULT_RULES;
  try {
    const parsed = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveIgnoreRules(rules: string[]): void {
  fs.mkdirSync(path.dirname(RULES_PATH), { recursive: true });
  fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2));
}

// Minimal glob matcher — only `*` (any run of chars) and `?` (single char) — enough for the patterns users
// actually type ("*.tmp", ".git", "Icon\r") without pulling in a full glob dependency for two wildcards.
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

let cachedRules: string[] | null = null;
let cachedRegexes: RegExp[] = [];

function getRegexes(): RegExp[] {
  const rules = loadIgnoreRules();
  if (cachedRules !== null && rules.length === cachedRules.length && rules.every((r, i) => r === cachedRules![i])) {
    return cachedRegexes;
  }
  cachedRules = rules;
  cachedRegexes = rules.map(globToRegExp);
  return cachedRegexes;
}

/** Matched against the bare file/dir NAME (not the full relative path) — same granularity as the old
 * hardcoded SKIP_NAMES set, which is what every pattern here is written against ("node_modules", not
 * "src/node_modules"). Applies at every directory level during the walk, so "node_modules" still excludes
 * it no matter how deep it's nested. Dotfile exclusion is a separate, non-overridable check the walker
 * still does itself — this only covers the user-editable pattern list. */
export function isIgnored(name: string): boolean {
  return getRegexes().some((re) => re.test(name));
}
