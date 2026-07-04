/**
 * One-time (or occasional) manual login script.
 *
 * Run this ONLY when you need to (re-)establish a Pikkit session:
 *   pnpm --filter @workspace/pikkit-bot run login
 *
 * What it does:
 *   1. Opens a real, visible Chromium window (headed).
 *   2. Navigates to the Pikkit login page.
 *   3. Waits for you to log in by hand (including any 2FA/captcha).
 *   4. Waits specifically until the authenticated Pikkit HOMEPAGE has
 *      actually loaded (URL matches the home page AND the network has
 *      gone idle) — not just any post-login redirect — before trusting
 *      the session.
 *   5. Saves a fresh authenticated browser storage state (cookies +
 *      local storage) to sessions/pikkit.json.
 *   6. Prints "Authenticated Successfully".
 *   7. Keeps the browser open for 5 more seconds so you can visually
 *      confirm you're actually logged in, then closes it.
 *
 * Every other script in this project should reuse sessions/pikkit.json
 * instead of logging in again. Re-run this script only when the saved
 * session expires or is revoked.
 *
 * NOTE: This script must be run somewhere with a visible display (e.g.
 * your own computer), since it launches a headed browser for you to
 * interact with. It will not work in a headless cloud environment.
 */
import { chromium } from "playwright";
import { PIKKIT_HOME_URL, PIKKIT_LOGIN_URL, SESSION_FILE } from "../config.js";

const POST_LOGIN_VERIFICATION_DELAY_MS = 5000;

async function main() {
  console.log("Opening Chromium so you can log into Pikkit...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(PIKKIT_LOGIN_URL);

  console.log("");
  console.log("A Chromium window has opened.");
  console.log("Please log into Pikkit manually in that window.");
  console.log(
    "This script will automatically continue once the authenticated Pikkit homepage has loaded.",
  );
  console.log("");

  // Step 1: wait until we've left the login page at all. This alone is
  // NOT proof of authentication — some flows briefly redirect through
  // intermediate pages — so it's only the first checkpoint.
  await page.waitForURL((url) => !url.toString().includes("/login"), {
    timeout: 0,
  });

  // Step 2: wait until we're actually on the authenticated Pikkit
  // homepage specifically (not just "somewhere that isn't /login"). If
  // login redirects elsewhere first, navigate there explicitly.
  await page.waitForURL((url) => url.toString().startsWith(PIKKIT_HOME_URL), {
    timeout: 0,
  });

  // Step 3: wait for the homepage to actually finish loading (network
  // idle), so we know real authenticated content has rendered, not just
  // that the URL bar changed.
  await page.waitForLoadState("networkidle");

  // Final guard: if something redirected us back to the login page after
  // all that (e.g. an expired/rejected session), do not save or report
  // success.
  if (page.url().includes("/login")) {
    throw new Error(
      "Ended up back on the login page after waiting for the homepage — login did not complete. Please try again.",
    );
  }

  await context.storageState({ path: SESSION_FILE });

  console.log("Authenticated Successfully");
  console.log(`Session saved to ${SESSION_FILE}`);
  console.log(
    `Keeping the browser open for ${POST_LOGIN_VERIFICATION_DELAY_MS / 1000} seconds so you can verify...`,
  );

  await page.waitForTimeout(POST_LOGIN_VERIFICATION_DELAY_MS);

  await browser.close();
  console.log("Done. You can now run the verify script.");
}

main().catch((error) => {
  console.error("Login script failed:", error);
  process.exit(1);
});
