/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Launches a real (headed by default) browser using the saved session,
 * navigates to Home, dismisses the mobile-sync modal, navigates directly
 * to /events (no sidebar click), waits for /events/all to complete,
 * clicks the first event card, logs every network request as it happens,
 * and prints full request/response details for the first /event/foryou/
 * call. This exists purely to compare what a real browser sends/receives
 * against what our API client sends/receives.
 *
 * Does not modify any existing auth/API code. Safe to delete once the
 * mismatch is found.
 *
 *   pnpm --filter @workspace/pikkit-bot run diagnose-headers
 *
 * Requires a valid saved session (see auth/login.ts).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { PIKKIT_HOME_URL, SESSION_FILE, isHeadless } from "../config.js";

const EVENT_DETAIL_URL_SUBSTRING = "/event/foryou/";
const EVENTS_ALL_URL_SUBSTRING = "/events/all";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

function printHeaders(title: string, headers: Record<string, string>): void {
  console.log(`${title}:`);
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const [key, value] of entries) {
    console.log(`  ${key}: ${value}`);
  }
}

function saveJson(filename: string, data: unknown): string {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const filePath = path.join(DEBUG_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

async function closeSyncModalIfPresent(page: Page): Promise<void> {
  const candidateSelectors = [
    'text="Syncing only available on mobile app"',
    '[role="dialog"] button[aria-label="Close" i]',
    '[role="dialog"] button:has-text("×")',
    '[role="dialog"] button:has-text("Close")',
    'button[aria-label="Close" i]',
  ];

  const attempted: string[] = [];

  for (const selector of candidateSelectors) {
    attempted.push(selector);
    const locator = page.locator(selector).first();
    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) {
      console.log(`Modal selector not found: ${selector}`);
      continue;
    }

    if (selector.startsWith("text=")) {
      const closeButtonSelector =
        '[role="dialog"] button[aria-label="Close" i], [role="dialog"] button:has-text("×")';
      attempted.push(closeButtonSelector);
      const closeButton = page.locator(closeButtonSelector).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
        console.log("Closed sync modal.");
        return;
      }
      console.log(`Modal text matched but close button not found via: ${closeButtonSelector}`);
      continue;
    }

    await locator.click();
    console.log("Closed sync modal.");
    return;
  }

  // No modal was found at all — this is expected on most calls to this
  // function (it's called defensively at several points), so this is
  // informational, not an error.
  console.log(`No sync modal present (attempted selectors: ${attempted.join(", ")}).`);
}

async function clickFirstEventCard(page: Page): Promise<void> {
  const candidateSelectors = [
    '[data-testid*="event-card" i]',
    '[class*="event-card" i]',
    '[class*="eventCard" i]',
    'main [role="button"]',
    'main a[href*="/event"]',
    'main li',
  ];

  const attempted: string[] = [];

  for (const selector of candidateSelectors) {
    attempted.push(selector);
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      console.log(`Found first event card via selector: ${selector}`);
      await locator.click();
      console.log("Clicked first event.");
      return;
    }
    console.log(`Selector failed for event card: ${selector}`);
  }

  throw new Error(
    "Could not find any event card to click. All attempted selectors failed:\n" +
      attempted.map((selector) => `  - ${selector}`).join("\n") +
      "\nInspect the real Events page markup and update clickFirstEventCard() in this script.",
  );
}

async function main(): Promise<void> {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      `No saved Pikkit session found at ${SESSION_FILE}. Run \`pnpm --filter @workspace/pikkit-bot run login\` first.`,
    );
  }

  const browser = await chromium.launch({ headless: isHeadless(false) });
  console.log("Opened browser.");
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  let matched = false;

  page.on("request", (request) => {
    console.log(`${request.method()} ${request.url()}`);
  });

  page.on("response", (response) => {
    if (matched || !response.url().includes(EVENT_DETAIL_URL_SUBSTRING)) {
      return;
    }
    matched = true;

    void (async () => {
      const request = response.request();

      console.log("\n=== Matched request: /event/foryou/ ===");
      console.log(`Request URL: ${request.url()}`);
      console.log(`Method: ${request.method()}`);

      printHeaders("\nFull request headers", request.headers());
      printHeaders("\nFull response headers", response.headers());

      console.log(`\nResponse status: ${response.status()} ${response.statusText()}`);

      let responseJson: unknown = null;
      try {
        responseJson = await response.json();
      } catch (error) {
        console.error("Failed to parse response body as JSON:", error);
      }

      console.log("\nResponse JSON:");
      console.log(JSON.stringify(responseJson, null, 2));

      if (responseJson !== null) {
        const savedPath = saveJson("event.json", responseJson);
        console.log(`\nSaved response JSON to ${savedPath}`);
      }

      console.log("\n=== End of matched request ===\n");
    })();
  });

  console.log(`Navigating to ${PIKKIT_HOME_URL} ...`);
  await page.goto(PIKKIT_HOME_URL, { waitUntil: "load" });
  console.log("Loaded Pikkit.");

  await page.waitForTimeout(1500);
  await closeSyncModalIfPresent(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await closeSyncModalIfPresent(page);

  const eventsUrl = new URL("events", PIKKIT_HOME_URL).toString();
  const eventsAllResponsePromise = page.waitForResponse(
    (response) => response.url().includes(EVENTS_ALL_URL_SUBSTRING),
    { timeout: 0 },
  );

  console.log(`Navigating directly to ${eventsUrl} ...`);
  await page.goto(eventsUrl, { waitUntil: "load" });
  console.log("Navigated directly to Events page.");

  await eventsAllResponsePromise;
  console.log("Events loaded.");

  await closeSyncModalIfPresent(page);

  await clickFirstEventCard(page);

  console.log("Waiting for /event/foryou request...");
  while (!matched) {
    await page.waitForTimeout(500);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter to close the browser and exit...");
  rl.close();

  await browser.close();
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
