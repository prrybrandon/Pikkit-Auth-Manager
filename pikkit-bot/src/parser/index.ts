/**
 * Public surface of the parser module. Only the parsing function and
 * its error type are exported — the raw JSON types in
 * `rawEventDetail.ts` stay internal to this folder.
 */
export { parseGame, ParserError } from "./parseGame.js";
