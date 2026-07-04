/**
 * Exposes authenticated requests to the rest of the app.
 *
 * This is the ONLY function outside of login.ts/verify.ts that knows
 * anything about how Pikkit authentication works. Every other module
 * (starting with the API client) must go through
 * `createAuthenticatedRequestContext()` instead of reading
 * sessions/pikkit.json or building auth headers itself.
 *
 * Implementation note: we use Playwright's `request` module (not a full
 * browser) to create an HTTP context seeded with the saved storage
 * state. Playwright automatically attaches the right cookies to every
 * request made through this context, exactly as a real browser would —
 * so no Authorization header is ever hardcoded anywhere in this project.
 */
import fs from "node:fs";
import { request, type APIRequestContext } from "playwright";
import { SESSION_FILE } from "../config.js";

export async function createAuthenticatedRequestContext(): Promise<APIRequestContext> {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      `No saved Pikkit session found at ${SESSION_FILE}. Run \`pnpm --filter @workspace/pikkit-bot run login\` first (on a machine with a visible browser).`,
    );
  }

  return request.newContext({ storageState: SESSION_FILE });
}
