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
 *   4. Once it detects you've navigated away from the login page,
 *      saves the authenticated browser storage state (cookies + local
 *      storage) to sessions/pikkit.json.
 *   5. Closes the browser.
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
import { PIKKIT_LOGIN_URL, SESSION_FILE } from "../config.js";

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
    "This script will automatically continue once it detects you have left the login page.",
  );
  console.log("");

  // Wait until the URL no longer looks like the login page. This is a
  // simple, robust signal that login succeeded, without needing to know
  // any Pikkit-specific DOM selectors.
  await page.waitForURL((url) => !url.toString().includes("/login"), {
    timeout: 0,
  });

  // Give the app a moment to finish setting cookies/local storage after
  // the redirect.
  await page.waitForTimeout(2000);

  await context.storageState({ path: SESSION_FILE });
  console.log(`Session saved to ${SESSION_FILE}`);

  await browser.close();
  console.log("Done. You can now run the verify script.");
}

main().catch((error) => {
  console.error("Login script failed:", error);
  process.exit(1);
});
