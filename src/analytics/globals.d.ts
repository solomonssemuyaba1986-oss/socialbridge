/**
 * Values Vite replaces at build time (see `vite.config.ts` → `define`).
 * Declared as a tiny type-only module so `tsc` knows about them.
 */
declare global {
  /** rachett build stamp, e.g. "0.0.0+2026-09-16" — stamped on every analytics batch. */
  const __APP_VERSION__: string
}

export {}
