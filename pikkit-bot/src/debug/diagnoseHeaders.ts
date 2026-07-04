/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Launches a real (headed by default) browser using the saved session,
 * navigates to Home, dismisses the mobile-sync modal, navigates directly
 * to /events (no sidebar click), and waits for /events/all to complete.
 *
 * Instead of guessing event-card selectors and clicking, this script now
 * performs DOM inspection: it saves the full rendered page HTML and dumps
 * every visible, interactive-looking element (tag/class/id/role/href/
 * aria-label/text) so the real selectors can be determined by inspection
 * rather than trial and error.
 *
 * Does not modify any existing auth/API code. Safe to delete once the
 * selectors are found.
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

const EVENTS_ALL_URL_SUBSTRING = "/events/all";

const SEARCH_STRINGS = ["MLB", "NBA", "NFL", "WNBA", "Moneyline", "Spread", "Over", "Under"];

const CLASS_KEYWORDS = ["event", "match", "game", "card", "tile", "bet", "row"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

interface DiscoveredElement {
  tag: string;
  className: string;
  id: string;
  role: string;
  href: string;
  ariaLabel: string;
  text: string;
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

async function inspectDom(page: Page): Promise<DiscoveredElement[]> {
  return page.evaluate(() => {
    const INTERACTIVE_TAGS = new Set([
      "a",
      "button",
      "div",
      "li",
      "article",
      "section",
      "span",
      "tr",
      "td",
    ]);

    const doc = (globalThis as any).document;
    const win = (globalThis as any).window;

    function isVisible(el: any): boolean {
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function looksInteractive(el: any): boolean {
      const tag = el.tagName.toLowerCase();
      if (tag === "a" || tag === "button") return true;
      const role = el.getAttribute("role");
      if (role && ["button", "link", "listitem", "row", "option", "tab"].includes(role)) {
        return true;
      }
      const style = win.getComputedStyle(el);
      if (style.cursor === "pointer") return true;
      if (el.hasAttribute("onclick")) return true;
      if (el.hasAttribute("href")) return true;
      if (INTERACTIVE_TAGS.has(tag)) return true;
      return false;
    }

    const results: {
      tag: string;
      className: string;
      id: string;
      role: string;
      href: string;
      ariaLabel: string;
      text: string;
    }[] = [];

    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));

    for (const el of allElements) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      const href = el.getAttribute("href") ?? "";

      if (!text && !href) continue;
      if (!isVisible(el)) continue;
      if (!looksInteractive(el)) continue;

      results.push({
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
        id: el.id ?? "",
        role: el.getAttribute("role") ?? "",
        href,
        ariaLabel: el.getAttribute("aria-label") ?? "",
        text: text.slice(0, 80),
      });
    }

    return results;
  });
}

async function collectClassNamesWithKeywords(page: Page, keywords: string[]): Promise<string[]> {
  return page.evaluate((keywordList: string[]) => {
    const doc = (globalThis as any).document;
    const found = new Set<string>();
    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));

    for (const el of allElements) {
      const className = typeof el.className === "string" ? el.className : "";
      if (!className) continue;
      for (const cls of className.split(/\s+/)) {
        if (!cls) continue;
        const lower = cls.toLowerCase();
        if (keywordList.some((keyword) => lower.includes(keyword))) {
          found.add(cls);
        }
      }
    }

    return Array.from(found).sort();
  }, keywords);
}

async function searchPageTextFor(page: Page, needles: string[]): Promise<Record<string, boolean>> {
  const bodyText = await page.evaluate(() => (globalThis as any).document.body.innerText ?? "");
  const results: Record<string, boolean> = {};
  for (const needle of needles) {
    results[needle] = bodyText.includes(needle);
  }
  return results;
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

  page.on("request", (request) => {
    console.log(`${request.method()} ${request.url()}`);
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

  console.log("Waiting 3 seconds for React to fully render...");
  await page.waitForTimeout(3000);

  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const htmlPath = path.join(DEBUG_DIR, "events.html");
  await fs.promises.writeFile(htmlPath, await page.content(), "utf8");
  console.log("Saved page HTML to debug/events.html");

  console.log("\nInspecting DOM for visible, interactive-looking elements...");
  const elements = await inspectDom(page);
  console.log(`Discovered ${elements.length} candidate elements.`);

  const toPrint = elements.slice(0, 200);
  if (toPrint.length === 0) {
    console.log(
      "No interactive elements were found. Inspect debug/events.html directly to determine selectors.",
    );
  } else {
    console.log(`\nPrinting first ${toPrint.length} discovered elements:\n`);
    toPrint.forEach((el, index) => {
      console.log(`[${index}]`);
      console.log(`tag: ${el.tag}`);
      console.log(`class: ${el.className}`);
      console.log(`id: ${el.id}`);
      console.log(`role: ${el.role}`);
      console.log(`href: ${el.href}`);
      console.log(`aria-label: ${el.ariaLabel}`);
      console.log(`text: ${el.text}`);
      console.log("");
    });
  }

  console.log("\nUnique class names matching keywords (event, match, game, card, tile, bet, row):");
  const matchingClassNames = await collectClassNamesWithKeywords(page, CLASS_KEYWORDS);
  if (matchingClassNames.length === 0) {
    console.log("  (none found)");
  } else {
    for (const className of matchingClassNames) {
      console.log(`  - ${className}`);
    }
  }

  console.log("\nSearching page text for known strings:");
  const searchResults = await searchPageTextFor(page, SEARCH_STRINGS);
  for (const [needle, found] of Object.entries(searchResults)) {
    console.log(`  ${needle}: ${found ? "found" : "not found"}`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\nPress Enter to close the browser and exit...");
  rl.close();

  await browser.close();
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
