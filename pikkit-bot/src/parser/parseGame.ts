/**
 * Converts raw Pikkit event-detail JSON into a normalized `Game` object.
 *
 * This is the only function that should ever read the raw JSON shape
 * defined in `rawEventDetail.ts`. Everything else in the app — the
 * collector, strategies, dashboard, etc. — should call `parseGame()`
 * and work with the returned `Game` only.
 */
import type {
  RawClosingLine,
  RawCommunity,
  RawMarketBreakdown,
  RawMoneyline,
  RawSpread,
  RawTotal,
} from "./rawEventDetail.js";
import type {
  ClosingLine,
  Community,
  Game,
  MarketBreakdown,
  Moneyline,
  SideBreakdown,
  Spread,
  Total,
} from "../types/game.js";

export class ParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParserError";
  }
}

function fail(field: string, raw: unknown): never {
  throw new ParserError(
    `Failed to parse Pikkit event detail — missing or invalid field "${field}".\n` +
      `Raw payload: ${JSON.stringify(raw, null, 2)}`,
  );
}

function asRecord(value: unknown, field: string, raw: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) fail(field, raw);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, raw: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail(field, raw);
  return value;
}

function requireNumber(value: unknown, field: string, raw: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) fail(field, raw);
  return value;
}

function requireSideBreakdown(value: unknown, field: string, raw: unknown): SideBreakdown {
  const obj = asRecord(value, field, raw);
  return {
    home: requireNumber(obj.home, `${field}.home`, raw),
    away: requireNumber(obj.away, `${field}.away`, raw),
  };
}

function requireMarketBreakdown(
  value: RawMarketBreakdown,
  field: string,
  raw: unknown,
): MarketBreakdown {
  return {
    betPercentages: requireSideBreakdown(value.bet_percentage, `${field}.bet_percentage`, raw),
    moneyPercentages: requireSideBreakdown(value.money_percentage, `${field}.money_percentage`, raw),
    handle: requireSideBreakdown(value.handle, `${field}.handle`, raw),
    bets: requireSideBreakdown(value.bets, `${field}.bets`, raw),
  };
}

function parseMoneyline(value: unknown, raw: unknown): Moneyline {
  const obj = asRecord(value, "moneyline", raw) as unknown as RawMoneyline;
  return {
    ...requireMarketBreakdown(obj, "moneyline", raw),
    homeOdds: requireNumber(obj.home_odds, "moneyline.home_odds", raw),
    awayOdds: requireNumber(obj.away_odds, "moneyline.away_odds", raw),
  };
}

function parseSpread(value: unknown, raw: unknown): Spread {
  const obj = asRecord(value, "spread", raw) as unknown as RawSpread;
  return {
    ...requireMarketBreakdown(obj, "spread", raw),
    line: requireNumber(obj.line, "spread.line", raw),
  };
}

function parseTotal(value: unknown, raw: unknown): Total {
  const obj = asRecord(value, "total", raw) as unknown as RawTotal;
  return {
    ...requireMarketBreakdown(obj, "total", raw),
    line: requireNumber(obj.line, "total.line", raw),
  };
}

function parseCommunity(value: unknown, raw: unknown): Community {
  const obj = asRecord(value, "community", raw) as unknown as RawCommunity;
  return {
    pick: typeof obj.pick === "string" ? obj.pick : null,
    confidence: typeof obj.confidence === "number" ? obj.confidence : null,
  };
}

function parseClosingLine(value: unknown, raw: unknown): ClosingLine | null {
  if (value === undefined || value === null) return null;

  const obj = asRecord(value, "closing_line", raw) as unknown as RawClosingLine;
  const result: ClosingLine = {};

  if (obj.moneyline) {
    result.moneyline = {
      homeOdds: requireNumber(obj.moneyline.home_odds, "closing_line.moneyline.home_odds", raw),
      awayOdds: requireNumber(obj.moneyline.away_odds, "closing_line.moneyline.away_odds", raw),
    };
  }
  if (obj.spread) {
    result.spread = { line: requireNumber(obj.spread.line, "closing_line.spread.line", raw) };
  }
  if (obj.total) {
    result.total = { line: requireNumber(obj.total.line, "closing_line.total.line", raw) };
  }

  return result;
}

/**
 * Parses raw Pikkit event-detail JSON into a normalized `Game`.
 * Throws a `ParserError` (with the offending field name and the raw
 * payload) if any required field is missing or the wrong type.
 */
export function parseGame(raw: unknown): Game {
  if (typeof raw !== "object" || raw === null) {
    throw new ParserError(
      `Failed to parse Pikkit event detail — expected a JSON object, got: ${JSON.stringify(raw)}`,
    );
  }
  const obj = raw as Record<string, unknown>;

  return {
    id: requireString(obj.event_id, "event_id", raw),
    league: requireString(obj.league, "league", raw),
    sport: requireString(obj.sport, "sport", raw),
    startTime: requireString(obj.start_time, "start_time", raw),
    homeTeam: requireString(obj.home_team, "home_team", raw),
    awayTeam: requireString(obj.away_team, "away_team", raw),
    status: typeof obj.status === "string" ? obj.status : null,
    moneyline: parseMoneyline(obj.moneyline, raw),
    spread: parseSpread(obj.spread, raw),
    total: parseTotal(obj.total, raw),
    community: obj.community !== undefined ? parseCommunity(obj.community, raw) : null,
    closingLine: parseClosingLine(obj.closing_line, raw),
  };
}
