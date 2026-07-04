/**
 * getTodaysEvents() — the only function allowed to know about Pikkit's
 * "events/all" endpoint.
 */
import { PIKKIT_API_BASE_URL } from "../../config.js";
import { pikkitApiClient } from "./client.js";
import type { EventSummary, PikkitRawEventListItem, PikkitRawEventsResponse } from "./types.js";

export function todayAsQueryDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertRawEventListItem(raw: unknown): asserts raw is PikkitRawEventListItem {
  const item = raw as Partial<PikkitRawEventListItem>;
  const requiredFields: (keyof PikkitRawEventListItem)[] = [
    "event_id",
    "league",
    "home_team",
    "away_team",
    "start_time",
  ];
  const missing = requiredFields.filter((field) => item[field] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Unexpected event shape from Pikkit — missing field(s): ${missing.join(", ")}.\n` +
        `Raw item: ${JSON.stringify(raw, null, 2)}\n` +
        `Update pikkit-bot/src/api/pikkit/types.ts to match the real response.`,
    );
  }
}

function normalizeEvent(raw: PikkitRawEventListItem): EventSummary {
  return {
    eventId: raw.event_id,
    league: raw.league,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    startTime: raw.start_time,
  };
}

/**
 * Fetches today's events from Pikkit.
 *
 * @param queryDate Optional override in `YYYY-MM-DD` form. Defaults to
 *   today (local date).
 */
export async function getTodaysEvents(queryDate: string = todayAsQueryDate()): Promise<EventSummary[]> {
  const url = `${PIKKIT_API_BASE_URL}/events/all?query_date=${encodeURIComponent(queryDate)}&league_offset=0`;
  const response = await pikkitApiClient.get<PikkitRawEventsResponse>(url);

  if (!Array.isArray(response?.events)) {
    throw new Error(
      `Unexpected response from ${url} — expected an "events" array.\n` +
        `Raw response: ${JSON.stringify(response, null, 2)}\n` +
        `Update pikkit-bot/src/api/pikkit/types.ts to match the real response.`,
    );
  }

  response.events.forEach(assertRawEventListItem);
  return response.events.map(normalizeEvent);
}
