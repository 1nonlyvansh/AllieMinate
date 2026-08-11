import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Restricted to src/ — without this, vitest's default glob also picks up the compiled
    // dist/**/*.test.js output of `tsc` (CommonJS, requires vitest via require() and fails), so
    // running `npm run build` before `npm test` locally would otherwise break the suite.
    include: ['src/**/*.test.ts'],
  },
});
