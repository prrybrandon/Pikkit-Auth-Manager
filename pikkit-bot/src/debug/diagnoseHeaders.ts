/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Launches a real (headed by default) browser using the saved session,
 * navigates directly to https://app.pikkit.com/events, waits for
 * /events/all to complete, then waits an additional 5 seconds for React
 * to finish hydrating/rendering.
 *
 * Its only purpose is to inspect what React actually rendered into the
 * live DOM (the previously-saved events.html only captured the initial
 * React shell, before hydration mounted any event cards). It does NOT
 * click anything and does NOT guess selectors — it dumps raw signal
 * (rendered HTML, visible text, element counts, keyword matches, and
 * elements with interaction-like attributes) so the real markup can be
 * inspected directly.
 *
 * Does not modify any existing auth/API code. Safe to delete once the
 * real markup has been identified.
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

const KEYWORDS = ["MLB", "NBA", "NFL", "Moneyline", "Spread", "Over", "Under"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

interface InteractiveElement {
  tag: string;
  className: string;
  id: string;
  role: string;
  href: string;
  dataTestId: string;
  onclick: boolean;
  cursorPointer: boolean;
  text: string;
}

interface KeywordMatch {
  keyword: string;
  tag: string;
  className: string;
  id: string;
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

async function getBasicDomStats(
  page: Page,
): Promise<{ innerHtmlLength: number; innerText: string; elementCount: number }> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    return {
      innerHtmlLength: doc.body.innerHTML.length,
      innerText: doc.body.innerText,
      elementCount: doc.querySelectorAll("*").length,
    };
  });
}

async function findKeywordMatches(page: Page, keywords: string[]): Promise<KeywordMatch[]> {
  return page.evaluate((keywordList: string[]) => {
    const doc = (globalThis as any).document;
    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));
    const matches: {
      keyword: string;
      tag: string;
      className: string;
      id: string;
      text: string;
    }[] = [];

    for (const el of allElements) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (!text) continue;

      for (const keyword of keywordList) {
        if (text.includes(keyword)) {
          matches.push({
            keyword,
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === "string" ? el.className : "",
            id: el.id ?? "",
            text: text.slice(0, 120),
          });
        }
      }
    }

    return matches;
  }, keywords);
}

async function findInteractiveLookingElements(page: Page): Promise<InteractiveElement[]> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    const win = (globalThis as any).window;
    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));
    const results: {
      tag: string;
      className: string;
      id: string;
      role: string;
      href: string;
      dataTestId: string;
      onclick: boolean;
      cursorPointer: boolean;
      text: string;
    }[] = [];

    for (const el of allElements) {
      const hasOnclick = el.hasAttribute("onclick") || typeof el.onclick === "function";
      const role = el.getAttribute("role") ?? "";
      const href = el.getAttribute("href") ?? "";
      const dataTestId = el.getAttribute("data-testid") ?? "";
      const cursorPointer = win.getComputedStyle(el).cursor === "pointer";

      if (!hasOnclick && !role && !href && !dataTestId && !cursorPointer) continue;

      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");

      results.push({
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
        id: el.id ?? "",
        role,
        href,
        dataTestId,
        onclick: hasOnclick,
        cursorPointer,
        text: text.slice(0, 80),
      });
    }

    return results;
  });
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

  console.log("Waiting 5 seconds for React to finish rendering...");
  await page.waitForTimeout(5000);

  const stats = await getBasicDomStats(page);
  console.log(`\ndocument.body.innerHTML.length: ${stats.innerHtmlLength}`);
  console.log(`document.querySelectorAll("*").length: ${stats.elementCount}`);

  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const liveDomPath = path.join(DEBUG_DIR, "live-dom.html");
  await fs.promises.writeFile(liveDomPath, await page.content(), "utf8");
  console.log(`Saved live DOM HTML to debug/live-dom.html`);

  const liveTextPath = path.join(DEBUG_DIR, "live-text.txt");
  await fs.promises.writeFile(liveTextPath, stats.innerText, "utf8");
  console.log(`Saved live body innerText to debug/live-text.txt`);

  console.log("\nSearching rendered DOM for keyword matches (MLB, NBA, NFL, Moneyline, Spread, Over, Under)...");
  const keywordMatches = await findKeywordMatches(page, KEYWORDS);
  if (keywordMatches.length === 0) {
    console.log("  (no elements found containing any of the keywords)");
  } else {
    console.log(`  Found ${keywordMatches.length} matching elements:\n`);
    keywordMatches.forEach((match, index) => {
      console.log(`[keyword match ${index}] "${match.keyword}"`);
      console.log(`  tag: ${match.tag}`);
      console.log(`  class: ${match.className}`);
      console.log(`  id: ${match.id}`);
      console.log(`  text: ${match.text}`);
      console.log("");
    });
  }

  console.log(
    "\nCollecting elements with onclick / role / href / cursor:pointer / data-testid...",
  );
  const interactiveElements = await findInteractiveLookingElements(page);
  console.log(`Discovered ${interactiveElements.length} such elements.`);

  const toPrint = interactiveElements.slice(0, 300);
  if (toPrint.length === 0) {
    console.log(
      "  (none found — inspect debug/live-dom.html directly to determine what React rendered)",
    );
  } else {
    console.log(`\nPrinting first ${toPrint.length} elements:\n`);
    toPrint.forEach((el, index) => {
      console.log(`[${index}]`);
      console.log(`tag: ${el.tag}`);
      console.log(`class: ${el.className}`);
      console.log(`id: ${el.id}`);
      console.log(`role: ${el.role}`);
      console.log(`href: ${el.href}`);
      console.log(`data-testid: ${el.dataTestId}`);
      console.log(`onclick: ${el.onclick}`);
      console.log(`cursor:pointer: ${el.cursorPointer}`);
      console.log(`text: ${el.text}`);
      console.log("");
    });
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
