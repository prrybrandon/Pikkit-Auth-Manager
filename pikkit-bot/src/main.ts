/**
 * Manual test/demo entrypoint for the API module (Milestone 2).
 *
 * Fetches today's events, fetches details for each, and prints the
 * fields required by SPEC.md. This is intentionally thin — it contains
 * no business logic of its own, it only calls the API module.
 *
 *   pnpm --filter @workspace/pikkit-bot run start
 *
 * Requires a valid saved session (see auth/login.ts).
 */
import { getEventDetails } from "./api/pikkit/eventDetails.js";
import { getTodaysEvents } from "./api/pikkit/events.js";
import { pikkitApiClient } from "./api/pikkit/client.js";
import type { EventDetails } from "./api/pikkit/types.js";

function printEventDetails(details: EventDetails): void {
  console.log("--------------------------------------------------");
  console.log(`League:       ${details.league}`);
  console.log(`Home Team:    ${details.homeTeam}`);
  console.log(`Away Team:    ${details.awayTeam}`);
  console.log(`Event ID:     ${details.eventId}`);
  console.log(`Start Time:   ${details.startTime}`);
  console.log(`Total Bets:   ${details.totalBets}`);
  console.log(`Total Handle: ${details.totalHandle}`);
  console.log(`Bet %:        home ${details.betPercentage.home}% / away ${details.betPercentage.away}%`);
  console.log(`Money %:      home ${details.moneyPercentage.home}% / away ${details.moneyPercentage.away}%`);
}

async function main(): Promise<void> {
  try {
    const events = await getTodaysEvents();
    console.log(`Found ${events.length} event(s) today.`);

    for (const event of events) {
      const details = await getEventDetails(event.eventId);
      printEventDetails(details);
    }
  } finally {
    await pikkitApiClient.dispose();
  }
}

main().catch((error) => {
  console.error("Failed to fetch Pikkit events:", error);
  process.exit(1);
});
