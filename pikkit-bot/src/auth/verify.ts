/**
 * Verifies that the saved Pikkit session (sessions/pikkit.json) is still
 * valid.
 *
 *   pnpm --filter @workspace/pikkit-bot run verify
 *
 * What it does:
 *   1. Loads the saved storage state from sessions/pikkit.json.
 *   2. Launches a headless browser (no visible window — safe to run
 *      anywhere, including this cloud environment or production).
 *   3. Navigates to Pikkit.
 *   4. Confirms we were NOT redirected to the login page.
 *   5. Prints "Authenticated Successfully" on success, or a clear error
 *      telling you to re-run the login script otherwise.
 *
 * This script (and everything built on top of it later) should only
 * ever read sessions/pikkit.json — it must never trigger a manual login
 * itself. If the session is invalid/expired, the fix is to run the
 * login script again from a machine with a visible browser.
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { isHeadless, PIKKIT_HOME_URL, SESSION_FILE } from "../config.js";

async function main() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error(`No saved session found at ${SESSION_FILE}.`);
    console.error(
      "Run `pnpm --filter @workspace/pikkit-bot run login` first (on a machine with a visible browser).",
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: isHeadless(true) });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  await page.goto(PIKKIT_HOME_URL);
  await page.waitForLoadState("networkidle").catch(() => {
    // Some apps keep background connections open indefinitely; ignore
    // the timeout and rely on the URL check below instead.
  });

  const currentUrl = page.url();
  const wasRedirectedToLogin = currentUrl.includes("/login");

  await browser.close();

  if (wasRedirectedToLogin) {
    console.error("Session is no longer valid — Pikkit redirected to the login page.");
    console.error(
      "Run `pnpm --filter @workspace/pikkit-bot run login` again to refresh authentication.",
    );
    process.exit(1);
  }

  console.log("Authenticated Successfully");
}

main().catch((error) => {
  console.error("Verify script failed:", error);
  process.exit(1);
});
