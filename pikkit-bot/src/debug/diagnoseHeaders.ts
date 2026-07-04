/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Launches a real (headed by default) browser using the saved session,
 * navigates to app.pikkit.com, dismisses the "Syncing only available on
 * mobile app" modal if it appears, and prints the exact headers
 * Playwright observes on the first request to /events/all. This exists
 * purely to compare what a real browser sends against what our API
 * client sends, since API requests are currently returning 401 despite a
 * valid saved session.
 *
 * Does not modify any existing auth/API code. Safe to delete once the
 * mismatch is found.
 *
 *   pnpm --filter @workspace/pikkit-bot run diagnose-headers
 *
 * Requires a valid saved session (see auth/login.ts).
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { PIKKIT_HOME_URL, SESSION_FILE, isHeadless } from "../config.js";

const REDACT_VALUE_LENGTH_THRESHOLD = 20;

function redactValue(value: string): string {
  if (value.length <= REDACT_VALUE_LENGTH_THRESHOLD) {
    return value;
  }
  return `${value.slice(0, 8)}...<redacted ${value.length} chars total>`;
}

function printHeaderGroup(title: string, entries: [string, string][]): void {
  console.log(`  ${title}:`);
  if (entries.length === 0) {
    console.log("    (none)");
    return;
  }
  for (const [key, value] of entries) {
    console.log(`    ${key}: ${redactValue(value)}`);
  }
}

async function dismissMobileSyncModalIfPresent(page: import("playwright").Page): Promise<void> {
  // The modal's exact markup isn't known ahead of time, so try a few
  // reasonably specific strategies rather than guessing a single selector.
  const candidateSelectors = [
    'text="Syncing only available on mobile app"',
    '[role="dialog"] button[aria-label="Close" i]',
    '[role="dialog"] button:has-text("×")',
    '[role="dialog"] button:has-text("Close")',
    'button[aria-label="Close" i]',
  ];

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector).first();
    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) continue;

    if (selector.startsWith("text=")) {
      // Found the modal's text — now look for a close/X button near it,
      // falling back to a generic dialog-level close button.
      const closeButton = page
        .locator('[role="dialog"] button[aria-label="Close" i], [role="dialog"] button:has-text("×")')
        .first();
      if (await closeButton.isVisible().catch(() => false)) {
        console.log('Dismissing "Syncing only available on mobile app" modal...');
        await closeButton.click();
        return;
      }
      continue;
    }

    console.log("Dismissing modal via close button...");
    await locator.click();
    return;
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      `No saved Pikkit session found at ${SESSION_FILE}. Run \`pnpm --filter @workspace/pikkit-bot run login\` first.`,
    );
  }

  const browser = await chromium.launch({ headless: isHeadless(false) });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  let matched = false;

  page.on("request", (request) => {
    const url = request.url();
    if (matched || !url.includes("/events/all")) {
      return;
    }
    matched = true;

    const allHeaders = request.headers();
    const headerEntries = Object.entries(allHeaders);

    console.log("\n=== Matched request: /events/all ===");
    console.log(`URL: ${url}`);
    console.log(`Method: ${request.method()}`);

    console.log("\nAll headers (as Playwright sees them):");
    printHeaderGroup("all headers", headerEntries.map(([k, v]) => [k, v] as [string, string]));

    const authHeader = headerEntries.find(([key]) => key.toLowerCase() === "authorization");
    console.log("\nAuthorization header:");
    console.log(`  ${authHeader ? redactValue(authHeader[1]) : "(not present)"}`);

    const cookieHeader = headerEntries.find(([key]) => key.toLowerCase() === "cookie");
    console.log("\nCookie header:");
    console.log(`  ${cookieHeader ? redactValue(cookieHeader[1]) : "(not present)"}`);

    const originHeader = headerEntries.find(([key]) => key.toLowerCase() === "origin");
    console.log("\nOrigin header:");
    console.log(`  ${originHeader ? originHeader[1] : "(not present)"}`);

    const refererHeader = headerEntries.find(([key]) => key.toLowerCase() === "referer");
    console.log("\nReferer header:");
    console.log(`  ${refererHeader ? refererHeader[1] : "(not present)"}`);

    const xHeaders = headerEntries.filter(([key]) => key.toLowerCase().startsWith("x-"));
    console.log();
    printHeaderGroup("x-* headers", xHeaders);

    const secHeaders = headerEntries.filter(([key]) => key.toLowerCase().startsWith("sec-"));
    console.log();
    printHeaderGroup("sec-* headers", secHeaders);

    console.log("\n=== End of matched request ===\n");
  });

  console.log(`Navigating to ${PIKKIT_HOME_URL} ...`);
  await page.goto(PIKKIT_HOME_URL, { waitUntil: "load" });

  // Give the app a moment to render and for any modal to appear, then
  // dismiss it if present before waiting for the network to settle.
  await page.waitForTimeout(1500);
  await dismissMobileSyncModalIfPresent(page);

  await page.waitForLoadState("networkidle").catch(() => {
    // Some apps keep background connections open indefinitely (e.g.
    // polling/websockets); ignore the timeout and keep waiting for the
    // specific /events/all request below instead.
  });

  // Check again in case the modal appeared after the initial idle wait.
  await dismissMobileSyncModalIfPresent(page);

  console.log("Waiting for an /events/all request to be observed (no timeout)...");
  while (!matched) {
    await page.waitForTimeout(500);
    // Keep dismissing the modal if it reappears (e.g. on navigation)
    // while we wait, since it blocks interaction/loading otherwise.
    await dismissMobileSyncModalIfPresent(page);
  }

  console.log("Headers printed above. Browser will stay open.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter to close the browser and exit...");
  rl.close();

  await browser.close();
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
