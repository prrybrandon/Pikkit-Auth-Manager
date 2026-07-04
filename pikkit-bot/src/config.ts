import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/**
 * Where the Pikkit login page lives. Update this if Pikkit changes its
 * login URL.
 */
export const PIKKIT_LOGIN_URL = "https://app.pikkit.com/login";

/**
 * Any authenticated Pikkit page we can use to confirm the session is
 * still valid (e.g. the dashboard/home page after login).
 */
export const PIKKIT_HOME_URL = "https://app.pikkit.com/";

/**
 * Where the saved Playwright storage state (cookies + local storage)
 * lives on disk. This file contains authenticated session data — it is
 * gitignored and must never be committed.
 */
export const SESSION_FILE = path.join(projectRoot, "sessions", "pikkit.json");

/**
 * Controls whether Playwright launches a visible (headed) browser or a
 * headless one.
 *
 * - Locally (on your own machine), run with `PLAYWRIGHT_HEADLESS=false`
 *   (the default here) so you can see and interact with the browser for
 *   the one-time manual login.
 * - In production/cloud environments (no display available), set
 *   `PLAYWRIGHT_HEADLESS=true` so Playwright never tries to open a
 *   visible window. Everyday runs (like `verify`) should use this.
 */
export function isHeadless(defaultValue: boolean): boolean {
  const raw = process.env.PLAYWRIGHT_HEADLESS;
  if (raw === undefined) return defaultValue;
  return raw.toLowerCase() === "true";
}
