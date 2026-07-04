/**
 * getEventDetails() — the only function allowed to know about Pikkit's
 * "event/foryou/{eventId}" endpoint.
 */
import { PIKKIT_API_BASE_URL } from "../../config.js";
import { pikkitApiClient } from "./client.js";
import type { EventDetails, PikkitRawEventDetails } from "./types.js";

function assertRawEventDetails(raw: unknown): asserts raw is PikkitRawEventDetails {
  const item = raw as Partial<PikkitRawEventDetails>;
  const requiredFields: (keyof PikkitRawEventDetails)[] = [
    "event_id",
    "league",
    "home_team",
    "away_team",
    "start_time",
    "total_bets",
    "total_handle",
    "bet_percentage",
    "money_percentage",
  ];
  const missing = requiredFields.filter((field) => item[field] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Unexpected event details shape from Pikkit — missing field(s): ${missing.join(", ")}.\n` +
        `Raw response: ${JSON.stringify(raw, null, 2)}\n` +
        `Update pikkit-bot/src/api/pikkit/types.ts to match the real response.`,
    );
  }
}

function normalizeEventDetails(raw: PikkitRawEventDetails): EventDetails {
  return {
    eventId: raw.event_id,
    league: raw.league,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    startTime: raw.start_time,
    totalBets: raw.total_bets,
    totalHandle: raw.total_handle,
    betPercentage: { home: raw.bet_percentage.home, away: raw.bet_percentage.away },
    moneyPercentage: { home: raw.money_percentage.home, away: raw.money_percentage.away },
  };
}

export async function getEventDetails(eventId: string): Promise<EventDetails> {
  const url = `${PIKKIT_API_BASE_URL}/event/foryou/${encodeURIComponent(eventId)}`;
  const response = await pikkitApiClient.get<PikkitRawEventDetails>(url);
  assertRawEventDetails(response);
  return normalizeEventDetails(response);
}
