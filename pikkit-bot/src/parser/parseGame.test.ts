import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseGame, ParserError } from "./parseGame.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  const contents = readFileSync(path.join(__dirname, "__fixtures__", name), "utf-8");
  return JSON.parse(contents);
}

describe("parseGame", () => {
  it("parses a full raw event detail into a normalized Game", () => {
    const raw = loadFixture("validEventDetail.json");
    const game = parseGame(raw);

    assert.equal(game.id, "evt_12345");
    assert.equal(game.league, "NFL");
    assert.equal(game.sport, "Football");
    assert.equal(game.homeTeam, "Kansas City Chiefs");
    assert.equal(game.awayTeam, "Buffalo Bills");
    assert.equal(game.startTime, "2026-07-04T20:00:00Z");
    assert.equal(game.status, "scheduled");

    assert.deepEqual(game.moneyline, {
      homeOdds: -150,
      awayOdds: 130,
      betPercentages: { home: 62, away: 38 },
      moneyPercentages: { home: 70, away: 30 },
      handle: { home: 700000, away: 300000 },
      bets: { home: 6200, away: 3800 },
    });

    assert.equal(game.spread.line, -3.5);
    assert.deepEqual(game.spread.betPercentages, { home: 55, away: 45 });

    assert.equal(game.total.line, 48.5);
    assert.deepEqual(game.total.moneyPercentages, { home: 52, away: 48 });

    assert.deepEqual(game.community, { pick: "home", confidence: 0.71 });
    assert.deepEqual(game.closingLine?.moneyline, { homeOdds: -155, awayOdds: 135 });
    assert.deepEqual(game.closingLine?.spread, { line: -3 });
    assert.deepEqual(game.closingLine?.total, { line: 47.5 });
  });

  it("defaults status/community/closingLine to null when absent", () => {
    const raw = loadFixture("noCommunityEventDetail.json");
    const game = parseGame(raw);

    assert.equal(game.community, null);
    assert.equal(game.closingLine, null);
    assert.equal(game.status, null);
  });

  it("throws a descriptive ParserError when a required market is missing", () => {
    const raw = loadFixture("missingSpreadEventDetail.json");

    assert.throws(() => parseGame(raw), ParserError);
    assert.throws(() => parseGame(raw), /spread/);
  });

  it("throws when the payload is not an object", () => {
    assert.throws(() => parseGame(null), ParserError);
    assert.throws(() => parseGame("not-json"), ParserError);
    assert.throws(() => parseGame(undefined), ParserError);
  });

  it("throws a descriptive error identifying the exact missing field", () => {
    const raw = loadFixture("validEventDetail.json") as Record<string, unknown>;
    delete raw.home_team;

    assert.throws(() => parseGame(raw), /home_team/);
  });

  it("never leaks raw (snake_case) JSON fields onto the parsed Game", () => {
    const raw = loadFixture("validEventDetail.json");
    const game = parseGame(raw) as unknown as Record<string, unknown>;

    assert.equal(game.event_id, undefined);
    assert.equal(game.home_team, undefined);
    assert.equal(game.bet_percentage, undefined);
    assert.equal(game.closing_line, undefined);
  });
});
