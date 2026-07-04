/**
 * Raw Pikkit event-detail JSON shape, as understood by the parser.
 *
 * These types are intentionally NOT exported outside the `parser/`
 * folder (nothing else in this module barrel re-exports them). Per
 * SPEC.md §7, raw JSON must never be exposed past the parser — only
 * `Game` objects (see `../types/game.ts`) leave this module.
 *
 * IMPORTANT: We still do not have a captured, real authenticated
 * response for the `/event/foryou/{id}` endpoint. This shape is our
 * best-effort assumption built from SPEC.md §8 (the Game model) and the
 * field list requested for this milestone. Once a real payload is
 * available, this is the only file that should need to change — update
 * it and re-run the parser's unit tests against a fixture built from the
 * real response.
 */

export interface RawSideBreakdown {
  home: number;
  away: number;
}

export interface RawMarketBreakdown {
  bet_percentage: RawSideBreakdown;
  money_percentage: RawSideBreakdown;
  handle: RawSideBreakdown;
  bets: RawSideBreakdown;
}

export interface RawMoneyline extends RawMarketBreakdown {
  home_odds: number;
  away_odds: number;
}

export interface RawSpread extends RawMarketBreakdown {
  line: number;
}

export interface RawTotal extends RawMarketBreakdown {
  line: number;
}

export interface RawCommunity {
  pick: string | null;
  confidence: number | null;
}

export interface RawClosingLine {
  moneyline?: { home_odds: number; away_odds: number };
  spread?: { line: number };
  total?: { line: number };
}

export interface RawEventDetail {
  event_id: string;
  league: string;
  sport: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status?: string | null;
  moneyline: RawMoneyline;
  spread: RawSpread;
  total: RawTotal;
  community: RawCommunity;
  closing_line?: RawClosingLine | null;
}
