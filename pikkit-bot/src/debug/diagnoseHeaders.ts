/**
 * TEMPORARY diagnostic script — not part of the production pipeline.
 *
 * Proof-of-concept: navigate from the Events page into a single event and
 * verify we landed on the event detail view, WITHOUT relying on generated
 * Chakra CSS class names (css-xxxxx).
 *
 * Strategy (in order of preference, most stable first):
 *   1. Elements with a semantic `role` (button/link/listitem/...) whose
 *      accessible text looks like a real event (contains a league keyword,
 *      "vs"/"@", or a team-like pattern).
 *   2. `<a>` tags whose `href` looks like an event link.
 *   3. Elements with a `data-testid`.
 *   4. Structural heuristic: elements that are part of a repeated group of
 *      similar siblings (a "card list") and contain event-like text or look
 *      clickable (cursor: pointer / onclick / role / href).
 *   5. Last resort: a structural DOM-hierarchy path (tag + nth-of-type from
 *      <body>). This does NOT use generated class names, but is the least
 *      stable of the strategies since it depends on sibling ordering.
 *
 * For each candidate (best first) we click it and verify success by
 * checking for a URL change or the appearance of Consensus/Money/Bet-style
 * percentages in the rendered text. If a click doesn't succeed, we inspect
 * the clicked element's parent and children, turn them into new candidates,
 * and keep trying (bounded, to avoid infinite loops).
 *
 * Writes a structured JSON report to debug/event-click-report.json and
 * prints a human-readable summary + extracted percentages (if found) to
 * the console.
 *
 * Does not modify any existing auth/API code.
 *
 *   pnpm --filter @workspace/pikkit-bot run diagnose-headers
 *
 * Requires a valid saved session (see auth/login.ts). This script cannot
 * perform an interactive login itself (no display in this environment) —
 * if the saved session is missing or expired, it reports that clearly and
 * exits instead of guessing.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { PIKKIT_HOME_URL, SESSION_FILE, isHeadless } from "../config.js";

const EVENTS_ALL_URL_SUBSTRING = "/events/all";
const MAX_ATTEMPTS = 25;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

interface CardCandidate {
  path: string;
  strategy: string;
  description: string;
  tag: string;
  role: string;
  href: string;
  dataTestId: string;
  text: string;
  confidence: number;
}

interface AttemptResult {
  attemptNumber: number;
  candidate: CardCandidate;
  clicked: boolean;
  clickError: string | null;
  urlBefore: string;
  urlAfter: string;
  urlChanged: boolean;
  consensusDetected: boolean;
  success: boolean;
}

async function closeSyncModalIfPresent(page: Page): Promise<void> {
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
      const closeButtonSelector =
        '[role="dialog"] button[aria-label="Close" i], [role="dialog"] button:has-text("×")';
      const closeButton = page.locator(closeButtonSelector).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
        console.log("Closed sync modal.");
        return;
      }
      continue;
    }

    await locator.click();
    console.log("Closed sync modal.");
    return;
  }
}

/**
 * Discovers candidate "event card" elements on the live, hydrated DOM using
 * multiple stability strategies. Explicitly ignores generated Chakra class
 * names (css-xxxxx) as a signal — they are never used for matching or
 * reported as "the selector".
 */
async function identifyEventCardCandidates(page: Page): Promise<CardCandidate[]> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    const win = (globalThis as any).window;

    const LEAGUE_KEYWORDS = ["MLB", "NBA", "NFL", "WNBA", "NHL", "NCAAF", "NCAAB"];
    const MATCHUP_PATTERN = /\bvs\.?\b|\@/i;

    function looksLikeEventText(text: string): boolean {
      if (!text) return false;
      if (LEAGUE_KEYWORDS.some((kw) => text.includes(kw))) return true;
      if (MATCHUP_PATTERN.test(text)) return true;
      return false;
    }

    function isClickableLooking(el: any): boolean {
      if (el.tagName === "A" || el.tagName === "BUTTON") return true;
      if (el.hasAttribute("onclick")) return true;
      const role = el.getAttribute("role");
      if (role && ["button", "link", "listitem", "row"].includes(role)) return true;
      if (win.getComputedStyle(el).cursor === "pointer") return true;
      return false;
    }

    function cssPath(el: any): string {
      const parts: string[] = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== doc.body) {
        let selector = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const siblingsOfSameTag = Array.from(parent.children).filter(
            (c: any) => c.tagName === node.tagName,
          );
          if (siblingsOfSameTag.length > 1) {
            const index = siblingsOfSameTag.indexOf(node) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(selector);
        node = parent;
      }
      return "body > " + parts.join(" > ");
    }

    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));
    const candidates: {
      path: string;
      strategy: string;
      description: string;
      tag: string;
      role: string;
      href: string;
      dataTestId: string;
      text: string;
      confidence: number;
    }[] = [];

    // Strategy 1 + 2 + 3: semantic role, href, data-testid — checked per element.
    for (const el of allElements) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (!text) continue;
      if (!looksLikeEventText(text)) continue;

      const role = el.getAttribute("role") ?? "";
      const href = el.getAttribute("href") ?? "";
      const dataTestId = el.getAttribute("data-testid") ?? "";
      const tag = el.tagName.toLowerCase();

      if (role && ["button", "link", "listitem", "row"].includes(role)) {
        candidates.push({
          path: cssPath(el),
          strategy: "role",
          description: `[role="${role}"] with event-like accessible text`,
          tag,
          role,
          href,
          dataTestId,
          text: text.slice(0, 120),
          confidence: 100,
        });
      }

      if (tag === "a" && href) {
        candidates.push({
          path: cssPath(el),
          strategy: "href",
          description: `<a href="${href}"> with event-like text`,
          tag,
          role,
          href,
          dataTestId,
          text: text.slice(0, 120),
          confidence: 95,
        });
      }

      if (dataTestId) {
        candidates.push({
          path: cssPath(el),
          strategy: "data-testid",
          description: `[data-testid="${dataTestId}"] with event-like text`,
          tag,
          role,
          href,
          dataTestId,
          text: text.slice(0, 120),
          confidence: 90,
        });
      }
    }

    // Strategy 4: structural — repeated sibling groups (card lists) whose
    // members contain event-like text or look clickable.
    const parentGroups = new Map<any, any[]>();
    for (const el of allElements) {
      const parent = el.parentElement;
      if (!parent) continue;
      if (!parentGroups.has(parent)) parentGroups.set(parent, []);
      parentGroups.get(parent)!.push(el);
    }

    for (const [, children] of parentGroups.entries()) {
      const tagCounts = new Map<string, number>();
      for (const child of children) {
        tagCounts.set(child.tagName, (tagCounts.get(child.tagName) ?? 0) + 1);
      }
      for (const [tag, count] of tagCounts.entries()) {
        if (count < 3) continue;
        const sameTagSiblings = children.filter((c) => c.tagName === tag);
        for (const child of sameTagSiblings) {
          const text = (child.textContent ?? "").trim().replace(/\s+/g, " ");
          if (!text) continue;
          const eventLike = looksLikeEventText(text);
          const clickable = isClickableLooking(child);
          if (!eventLike && !clickable) continue;

          candidates.push({
            path: cssPath(child),
            strategy: "structural-sibling-group",
            description:
              `repeated sibling group of <${tag.toLowerCase()}> (${sameTagSiblings.length} similar siblings)` +
              (eventLike ? ", event-like text" : "") +
              (clickable ? ", looks clickable" : ""),
            tag: child.tagName.toLowerCase(),
            role: child.getAttribute("role") ?? "",
            href: child.getAttribute("href") ?? "",
            dataTestId: child.getAttribute("data-testid") ?? "",
            text: text.slice(0, 120),
            confidence: (eventLike ? 40 : 0) + (clickable ? 30 : 0),
          });
        }
      }
    }

    // Dedupe by path, keeping the highest-confidence entry for each.
    const byPath = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const existing = byPath.get(candidate.path);
      if (!existing || candidate.confidence > existing.confidence) {
        byPath.set(candidate.path, candidate);
      }
    }

    return Array.from(byPath.values()).sort((a, b) => b.confidence - a.confidence);
  });
}

/**
 * Given a failed candidate's path, inspects its parent and direct children
 * on the live DOM and returns them as new candidates to try next.
 */
async function deriveNearbyCandidates(page: Page, failedPath: string): Promise<CardCandidate[]> {
  return page
    .evaluate((selector: string) => {
      const doc = (globalThis as any).document;

      function cssPath(el: any): string {
        const parts: string[] = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== doc.body) {
          let sel = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const siblingsOfSameTag = Array.from(parent.children).filter(
              (c: any) => c.tagName === node.tagName,
            );
            if (siblingsOfSameTag.length > 1) {
              const index = siblingsOfSameTag.indexOf(node) + 1;
              sel += `:nth-of-type(${index})`;
            }
          }
          parts.unshift(sel);
          node = parent;
        }
        return "body > " + parts.join(" > ");
      }

      const el = doc.querySelector(selector);
      if (!el) return [];

      const nearby: any[] = [];
      if (el.parentElement && el.parentElement !== doc.body) {
        nearby.push(el.parentElement);
      }
      nearby.push(...Array.from(el.children));

      return nearby.map((node: any) => {
        const text = (node.textContent ?? "").trim().replace(/\s+/g, " ");
        return {
          path: cssPath(node),
          strategy: "nearby-fallback",
          description: `${node === el.parentElement ? "parent" : "child"} of previously-tried element <${node.tagName.toLowerCase()}>`,
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute("role") ?? "",
          href: node.getAttribute("href") ?? "",
          dataTestId: node.getAttribute("data-testid") ?? "",
          text: text.slice(0, 120),
          confidence: 10,
        };
      });
    }, failedPath)
    .catch(() => [] as CardCandidate[]);
}

async function detectConsensusPercentages(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const text: string = (globalThis as any).document.body.innerText ?? "";
    return /consensus/i.test(text) || /money\s*%/i.test(text) || /bet\s*%/i.test(text);
  });
}

async function extractPercentageValues(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    const allElements: any[] = Array.from(doc.querySelectorAll("body *"));
    const results: Record<string, string[]> = { consensus: [], money: [], bet: [] };

    for (const el of allElements) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (!text || text.length > 200) continue;

      if (/consensus/i.test(text) && /%/.test(text)) {
        results.consensus.push(text);
      }
      if (/money\s*%/i.test(text) || (/\bmoney\b/i.test(text) && /%/.test(text))) {
        results.money.push(text);
      }
      if (/bet\s*%/i.test(text) || (/\bbet\b/i.test(text) && /%/.test(text))) {
        results.bet.push(text);
      }
    }

    for (const key of Object.keys(results)) {
      results[key] = Array.from(new Set(results[key])).slice(0, 10);
    }

    return results;
  });
}

async function tryCandidate(
  page: Page,
  candidate: CardCandidate,
  attemptNumber: number,
): Promise<AttemptResult> {
  const urlBefore = page.url();
  let clicked = false;
  let clickError: string | null = null;

  try {
    const locator = page.locator(candidate.path).first();
    const isVisible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) {
      clickError = "element not visible";
    } else {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 5000 });
      clicked = true;
    }
  } catch (error) {
    clickError = error instanceof Error ? error.message : String(error);
  }

  if (clicked) {
    await page.waitForTimeout(1500);
  }

  const urlAfter = page.url();
  const urlChanged = urlAfter !== urlBefore;
  const consensusDetected = clicked ? await detectConsensusPercentages(page) : false;

  return {
    attemptNumber,
    candidate,
    clicked,
    clickError,
    urlBefore,
    urlAfter,
    urlChanged,
    consensusDetected,
    success: clicked && (urlChanged || consensusDetected),
  };
}

async function main(): Promise<void> {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      `No saved Pikkit session found at ${SESSION_FILE}. Run \`pnpm --filter @workspace/pikkit-bot run login\` first. ` +
        `This script cannot perform an interactive login itself.`,
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

  if (page.url().includes("/login")) {
    console.error(
      "\nLanded on /login — the saved session is missing or expired. " +
        "Cannot log in automatically (this environment has no display for interactive login). " +
        "Run `pnpm --filter @workspace/pikkit-bot run login` locally, then re-run this script.",
    );
    await browser.close();
    process.exit(1);
  }
  console.log("Loaded Pikkit (session valid, no login required).");

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

  console.log("\nIdentifying event card candidates (ignoring generated Chakra class names)...");
  let candidateQueue = await identifyEventCardCandidates(page);
  console.log(`Found ${candidateQueue.length} candidate elements.`);

  const attempts: AttemptResult[] = [];
  const triedPaths = new Set<string>();
  let winningAttempt: AttemptResult | null = null;

  let attemptNumber = 0;
  while (candidateQueue.length > 0 && attemptNumber < MAX_ATTEMPTS && !winningAttempt) {
    const candidate = candidateQueue.shift()!;
    if (triedPaths.has(candidate.path)) continue;
    triedPaths.add(candidate.path);
    attemptNumber += 1;

    console.log(
      `\n[attempt ${attemptNumber}] strategy=${candidate.strategy} confidence=${candidate.confidence}`,
    );
    console.log(`  description: ${candidate.description}`);
    console.log(`  path: ${candidate.path}`);
    console.log(`  text: ${candidate.text}`);

    const result = await tryCandidate(page, candidate, attemptNumber);
    attempts.push(result);

    if (result.clickError) {
      console.log(`  click error: ${result.clickError}`);
    } else {
      console.log(`  clicked: ${result.clicked}`);
      console.log(`  url before: ${result.urlBefore}`);
      console.log(`  url after: ${result.urlAfter}`);
      console.log(`  url changed: ${result.urlChanged}`);
      console.log(`  consensus/money/bet text detected: ${result.consensusDetected}`);
    }

    if (result.success) {
      console.log("  SUCCESS — this candidate opened the event.");
      winningAttempt = result;
      break;
    }

    console.log("  Not confirmed successful. Inspecting nearby parent/child elements...");
    const nearbyCandidates = await deriveNearbyCandidates(page, candidate.path);
    const newOnes = nearbyCandidates.filter((c) => !triedPaths.has(c.path));
    console.log(`  Derived ${newOnes.length} new nearby candidates to try.`);
    candidateQueue = [...newOnes, ...candidateQueue];

    // If we navigated away without success being detected, navigate back to
    // /events before trying the next candidate.
    if (result.urlChanged && !result.success) {
      console.log("  URL changed but success criteria not met — navigating back to /events.");
      await page.goto(eventsUrl, { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  let extractedValues: Record<string, string[]> | null = null;
  if (winningAttempt) {
    extractedValues = await extractPercentageValues(page);
  }

  const report = {
    timestamp: new Date().toISOString(),
    totalCandidatesDiscovered: attempts.length + candidateQueue.length,
    attemptsMade: attempts.length,
    attempts,
    success: winningAttempt !== null,
    winningCandidate: winningAttempt?.candidate ?? null,
    extractedValues,
  };

  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const reportPath = path.join(DEBUG_DIR, "event-click-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n=== SUMMARY ===");
  if (winningAttempt) {
    console.log(`Event cards identified via strategy: ${winningAttempt.candidate.strategy}`);
    console.log(`Most reliable selector approach: ${winningAttempt.candidate.description}`);
    console.log(`Clicking opened the event: true`);
    console.log(`Consensus/Money/Bet text visible: ${winningAttempt.consensusDetected}`);
    console.log("\nExtracted percentage-related text (JSON):");
    console.log(JSON.stringify(extractedValues, null, 2));
  } else {
    console.log("No candidate succeeded in opening an event within the attempt budget.");
    console.log(`Attempts made: ${attempts.length}`);
    console.log(
      "Inspect debug/event-click-report.json for every candidate tried, its selector, and why it failed.",
    );
  }
  console.log(`\nFull report saved to debug/event-click-report.json`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\nPress Enter to close the browser and exit...");
  rl.close();

  await browser.close();
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
