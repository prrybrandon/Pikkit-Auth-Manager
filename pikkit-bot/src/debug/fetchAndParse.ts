/**
 * Manual validation script — NOT part of the production pipeline.
 *
 * Fetches real data from Pikkit using the saved session, saves the raw
 * JSON responses to debug/, and runs the event-detail payload through
 * parseGame() to confirm the parser matches Pikkit's actual response
 * shape. Use this whenever the API or parser need to be checked against
 * live data.
 *
 *   pnpm --filter @workspace/pikkit-bot run debug
 *
 * Requires a valid saved session (see auth/login.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pikkitApiClient } from "../api/pikkit/client.js";
import { todayAsQueryDate } from "../api/pikkit/events.js";
import { PIKKIT_API_BASE_URL } from "../config.js";
import { ParserError, parseGame } from "../parser/parseGame.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const DEBUG_DIR = path.join(projectRoot, "debug");

function saveJson(filename: string, data: unknown): string {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const filePath = path.join(DEBUG_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function extractFirstEventId(rawEventsResponse: unknown): string {
  const obj = rawEventsResponse as Record<string, unknown> | null;
  const events = obj?.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error(
      "Could not find any events in the raw response to test with. " +
        "Raw response was saved to debug/events.json — inspect it to see the real shape.",
    );
  }

  const first = events[0] as Record<string, unknown>;
  const eventId = first.event_id ?? first.id;
  if (typeof eventId !== "string" && typeof eventId !== "number") {
    throw new Error(
      "Could not find an event id field on the first event. " +
        "Raw response was saved to debug/events.json — inspect it and update this script's field lookup.",
    );
  }
  return String(eventId);
}

async function main(): Promise<void> {
  try {
    console.log("Fetching today's events (raw)...");
    const queryDate = todayAsQueryDate();
    const eventsUrl = `${PIKKIT_API_BASE_URL}/events/all?query_date=${encodeURIComponent(queryDate)}&league_offset=0`;
    const rawEvents = await pikkitApiClient.get<unknown>(eventsUrl);

    const eventsPath = saveJson("events.json", rawEvents);
    console.log(`Saved raw events response to ${eventsPath}`);

    const eventId = extractFirstEventId(rawEvents);
    console.log(`Using event id: ${eventId}`);

    console.log("Fetching event details (raw)...");
    const eventDetailsUrl = `${PIKKIT_API_BASE_URL}/event/foryou/${encodeURIComponent(eventId)}`;
    const rawEvent = await pikkitApiClient.get<unknown>(eventDetailsUrl);

    const eventPath = saveJson("event.json", rawEvent);
    console.log(`Saved raw event detail response to ${eventPath}`);

    console.log("Parsing event through parseGame()...");
    try {
      const game = parseGame(rawEvent);
      console.log("Parsed Game object:");
      console.log(JSON.stringify(game, null, 2));
    } catch (error) {
      if (error instanceof ParserError) {
        console.error("parseGame() failed with a ParserError:");
        console.error(error.message);
        const failedPath = saveJson("event-parse-failed.json", rawEvent);
        console.error(`Raw payload that failed to parse was also saved to ${failedPath}.`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  } finally {
    await pikkitApiClient.dispose();
  }
}

main().catch((error) => {
  console.error("Debug script failed:", error);
  process.exit(1);
});
