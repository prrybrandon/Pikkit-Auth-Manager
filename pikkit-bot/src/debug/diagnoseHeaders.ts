/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Launches a real (headed by default) browser using the saved session,
 * navigates the Pikkit UI exactly as a user would (Home -> Events ->
 * first event card), and prints the request/response details for the
 * resulting /event/foryou/{eventId} call. This exists purely to compare
 * what a real browser sends/receives against what our API client
 * sends/receives.
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
import { chromium, type Page, type Response } from "playwright";
import { PIKKIT_HOME_URL, SESSION_FILE, isHeadless } from "../config.js";

const REDACT_VALUE_LENGTH_THRESHOLD = 20;
const EVENT_DETAIL_URL_PATTERN = /\/event\/foryou\/[^/?#]+/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

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

async function dismissMobileSyncModalIfPresent(page: Page): Promise<void> {
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

async function clickEventsSidebarLink(page: Page): Promise<void> {
  console.log('Clicking "Events" in the sidebar...');
  const candidateSelectors = [
    'nav a:has-text("Events")',
    'aside a:has-text("Events")',
    '[role="navigation"] a:has-text("Events")',
    'a:has-text("Events")',
    'nav button:has-text("Events")',
    'aside button:has-text("Events")',
    'button:has-text("Events")',
  ];

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return;
    }
  }

  throw new Error(
    'Could not find an "Events" sidebar item to click with any of the known selectors. ' +
      "Inspect the real sidebar markup and update clickEventsSidebarLink() in this script.",
  );
}

async function verifyOnEventsPage(page: Page): Promise<void> {
  const url = page.url();
  if (!url.includes("/events") && !url.toLowerCase().includes("event")) {
    throw new Error(`Expected to be on the Events page after clicking, but URL is: ${url}`);
  }
  console.log(`Confirmed on Events page: ${url}`);
}

async function clickFirstEventCard(page: Page): Promise<void> {
  console.log("Clicking the first event card...");
  const candidateSelectors = [
    '[data-testid*="event-card" i]',
    '[class*="event-card" i]',
    '[class*="eventCard" i]',
    'main [role="button"]',
    'main a[href*="/event"]',
    'main li',
  ];

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return;
    }
  }

  throw new Error(
    "Could not find any event card to click with any of the known selectors. " +
      "Inspect the real Events page markup and update clickFirstEventCard() in this script.",
  );
}

function saveJson(filename: string, data: unknown): string {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const filePath = path.join(DEBUG_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
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

  const responsePromise = new Promise<Response>((resolve) => {
    page.on("response", (response) => {
      if (EVENT_DETAIL_URL_PATTERN.test(response.url())) {
        resolve(response);
      }
    });
  });

  console.log(`Navigating to ${PIKKIT_HOME_URL} ...`);
  await page.goto(PIKKIT_HOME_URL, { waitUntil: "load" });

  await page.waitForTimeout(1500);
  await dismissMobileSyncModalIfPresent(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissMobileSyncModalIfPresent(page);

  await clickEventsSidebarLink(page);

  await page.waitForTimeout(1000);
  await dismissMobileSyncModalIfPresent(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissMobileSyncModalIfPresent(page);

  await verifyOnEventsPage(page);

  await clickFirstEventCard(page);

  console.log("Waiting for the /event/foryou/{eventId} request/response (no timeout)...");
  const response = await responsePromise;
  const request = response.request();

  const headerEntries = Object.entries(request.headers());

  console.log("\n=== Matched request: /event/foryou/{eventId} ===");
  console.log(`Request URL: ${request.url()}`);
  console.log(`Method: ${request.method()}`);

  console.log("\nRequest headers:");
  printHeaderGroup("headers", headerEntries.map(([k, v]) => [k, v] as [string, string]));

  console.log(`\nResponse status: ${response.status()} ${response.statusText()}`);

  let responseJson: unknown;
  try {
    responseJson = await response.json();
  } catch (error) {
    console.error("Failed to parse response body as JSON:", error);
    responseJson = null;
  }

  console.log("\nResponse JSON:");
  console.log(JSON.stringify(responseJson, null, 2));

  if (responseJson !== null) {
    const savedPath = saveJson("event.json", responseJson);
    console.log(`\nSaved response JSON to ${savedPath}`);
  }

  console.log("\n=== End of matched request ===\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter to close the browser and exit...");
  rl.close();

  await browser.close();
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
