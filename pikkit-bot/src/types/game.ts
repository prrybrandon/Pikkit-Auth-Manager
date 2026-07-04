/**
 * The normalized Game model (SPEC.md §8). This is the ONLY shape that
 * flows out of the parser. Strategies, the scheduler's per-game state,
 * and the dashboard all depend on this type — never on Pikkit's raw
 * JSON.
 */

export interface SideBreakdown {
  home: number;
  away: number;
}

/** Fields shared by every betting market (moneyline, spread, total). */
export interface MarketBreakdown {
  betPercentages: SideBreakdown;
  moneyPercentages: SideBreakdown;
  handle: SideBreakdown;
  bets: SideBreakdown;
}

export interface Moneyline extends MarketBreakdown {
  homeOdds: number;
  awayOdds: number;
}

export interface Spread extends MarketBreakdown {
  line: number;
}

export interface Total extends MarketBreakdown {
  line: number;
}

/** Community consensus pick for the game, when Pikkit provides one. */
export interface Community {
  pick: string | null;
  confidence: number | null;
}

/** Lines as they stood at kickoff, when Pikkit provides them. */
export interface ClosingLine {
  moneyline?: { homeOdds: number; awayOdds: number };
  spread?: { line: number };
  total?: { line: number };
}

export interface Game {
  id: string;
  league: string;
  sport: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  status: string | null;
  moneyline: Moneyline;
  spread: Spread;
  total: Total;
  community: Community | null;
  closingLine: ClosingLine | null;
}
