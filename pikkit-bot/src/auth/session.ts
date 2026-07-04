/**
 * Exposes authenticated requests to the rest of the app.
 *
 * This is the ONLY function outside of login.ts/verify.ts that knows
 * anything about how Pikkit authentication works. Every other module
 * (starting with the API client) must go through
 * `createAuthenticatedRequestContext()` instead of reading
 * sessions/pikkit.json or building auth headers itself.
 *
 * Implementation note: Pikkit's API does not treat `Authorization` as an
 * independent bearer token — it expects the header's value to be exactly
 * equal to the `session_id` cookie set at login. So in addition to
 * seeding the request context with the saved storage state (so cookies
 * are attached automatically like a real browser), we read the
 * `session_id` cookie out of that same storage state and mirror it onto
 * an `Authorization` header applied to every request made through this
 * context. Nothing here is hardcoded — the value always comes from
 * whatever `session_id` currently is in the saved session file.
 */
import fs from "node:fs";
import { request, type APIRequestContext } from "playwright";
import { SESSION_FILE } from "../config.js";

interface StorageStateCookie {
  name: string;
  value: string;
}

interface StorageState {
  cookies?: StorageStateCookie[];
}

function readSessionIdCookie(): string {
  const raw = fs.readFileSync(SESSION_FILE, "utf-8");
  const storageState = JSON.parse(raw) as StorageState;
  const sessionCookie = storageState.cookies?.find((cookie) => cookie.name === "session_id");

  if (!sessionCookie || !sessionCookie.value) {
    throw new Error("No authenticated Pikkit session found.");
  }

  return sessionCookie.value;
}

export async function createAuthenticatedRequestContext(): Promise<APIRequestContext> {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      `No saved Pikkit session found at ${SESSION_FILE}. Run \`pnpm --filter @workspace/pikkit-bot run login\` first (on a machine with a visible browser).`,
    );
  }

  const sessionId = readSessionIdCookie();

  return request.newContext({
    storageState: SESSION_FILE,
    extraHTTPHeaders: {
      Authorization: sessionId,
    },
  });
}
