// The one place the `/wesele` prefix is defined: it is Vite's `base` (vite.config.ts), exposed as
// `import.meta.env.BASE_URL` ("/wesele/"). Router basename and API base are derived from it, so
// components never hardcode the prefix (ADR-001 §3).
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '')

/** Prefix of every REST call: `/wesele/api`. */
export const API_BASE = `${BASE_PATH}/api`
