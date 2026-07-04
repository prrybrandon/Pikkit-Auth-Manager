/**
 * Types for Pikkit's data API.
 *
 * IMPORTANT: We do not have a sample authenticated response on hand
 * while writing this (only the endpoint shapes and the list of fields
 * we need to display). The `PikkitRaw*` interfaces below are our
 * best-effort guess at the JSON shape, based on the fields required by
 * this milestone. `events.ts` and `eventDetails.ts` validate the fields
 * they actually use at runtime and throw a clear error (dumping the raw
 * payload) if a field is missing, rather than silently returning
 * wrong/undefined data.
 *
 * If Pikkit's real response uses different field names, this is the
 * only file that needs to change — everything downstream depends on the
 * `EventSummary`/`EventDetails` types, not on the raw shape.
 */

export interface PikkitRawEventListItem {
  event_id: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
}

export interface PikkitRawEventsResponse {
  events: PikkitRawEventListItem[];
}

export interface PikkitRawSideBreakdown {
  home: number;
  away: number;
}

export interface PikkitRawEventDetails {
  event_id: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  total_bets: number;
  total_handle: number;
  bet_percentage: PikkitRawSideBreakdown;
  money_percentage: PikkitRawSideBreakdown;
}

/** Normalized, camelCase view used by the rest of the app. */
export interface EventSummary {
  eventId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
}

export interface SideBreakdown {
  home: number;
  away: number;
}

export interface EventDetails {
  eventId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  totalBets: number;
  totalHandle: number;
  betPercentage: SideBreakdown;
  moneyPercentage: SideBreakdown;
}
