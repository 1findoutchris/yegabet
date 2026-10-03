export interface Game {
  gameID: string;
  gameNameEn: string;
  img: string;
  customGameType: number;
  vendorCode: string | number;
  provider: string;
  /** Display name when the provider isn't in PROVIDER_META (Octhera games). */
  providerName?: string;
  /** Category from the feed, for providers not in the crash/live lists (Octhera games). */
  kind?: "crash" | "live";
}

// The Betby sportsbook launches through the shared game-launch endpoint, but it
// is not a casino game — exclude it from recently-played / recommendations.
// Provider-specific: Silent's UID is the default; Gregmorn's BetBy entry is
// "nova:sports-betby:sports" — set NEXT_PUBLIC_SPORTSBOOK_GAME_UID on cutover.
export const SPORTSBOOK_GAME_UID =
  process.env.NEXT_PUBLIC_SPORTSBOOK_GAME_UID || "8a704858d5deb4af1ddc722092ac7614";

// Spribe Aviator served through the Octhera aggregator (not the main game
// provider). A catalog entry like any other, but /api/games/launch routes this
// id to Octhera. Shown only while OCTHERA_AVIATOR_PUBLIC=true (see lib/games).
export const OCTHERA_AVIATOR_ID = "octhera:aviator";

// Every other Octhera game is "octhera:<gameUid>" — shown while
// OCTHERA_GAMES_PUBLIC=true, and launched through Octhera the same way.
export const OCTHERA_ID_PREFIX = "octhera:";

export interface Provider {
  slug: string;
  name: string;
  logo?: string;
}

export const PROVIDER_META: Record<string, { name: string; logo?: string }> = {
  // Slots & mixed
  jili:               { name: "JILI" },
  btgaming:           { name: "BTGaming" },
  bigtimaming:        { name: "Big Time Gaming" },
  "bigtimaming-asia": { name: "Big Time Gaming" },
  pgsoft:             { name: "PG Soft" },
  cq9:                { name: "CQ9" },
  bgaming:            { name: "BGaming" },
  bng:                { name: "BNG" },
  "bng-asia":         { name: "BNG" },
  "hacksaw-asia":     { name: "Hacksaw" },
  jdb:                { name: "JDB" },
  fachaigaming:       { name: "Fachai" },
  fastspin:           { name: "FastSpin" },
  mini:               { name: "Mini Games" },
  "2j":               { name: "2J" },
  "3oks-row":         { name: "3 Oaks" },
  "evoplay-eu":       { name: "Evoplay" },
  "evoplay-asia":     { name: "Evoplay" },
  netent:             { name: "NetEnt" },
  "netent-asia":      { name: "NetEnt" },
  microgaming:        { name: "Microgaming" },
  playtech:           { name: "Playtech" },
  playson:            { name: "Playson" },
  playngo:            { name: "Play'n GO" },
  habanero:           { name: "Habanero" },
  "nolimitcity":      { name: "No Limit City" },
  "nolimitcity-asia": { name: "No Limit City" },
  redtiger:           { name: "Red Tiger" },
  "redtiger-asia":    { name: "Red Tiger" },
  relaxgaming:        { name: "Relax Gaming" },
  "pragmaticplay-eu": { name: "Pragmatic Play" },
  "pragmaticplay-asia":{ name: "Pragmatic Play" },
  skywind:            { name: "Skywind" },
  rich88:             { name: "Rich88" },
  ace:                { name: "ACE" },
  wonwon:             { name: "WonWon" },
  nextspin:           { name: "NextSpin" },
  tadagaming:         { name: "Tada Gaming" },
  unitedgaming:       { name: "United Gaming" },
  "5ggaming":         { name: "5G Gaming" },
  pgsgaming:          { name: "PGS Gaming" },
  kmideal:            { name: "KM iDeal" },
  kygaming:           { name: "KY Gaming" },
  "mac88_games":      { name: "Mac88" },
  aog:                { name: "AOG" },
  astar:              { name: "Astar" },
  rg:                 { name: "RG" },
  tf:                 { name: "TF Gaming" },
  // Crash / instant
  spribe:             { name: "Spribe" },
  smartsoft:          { name: "SmartSoft" },
  "turbogames-world": { name: "TurboGames" },
  "turbogames-asia":  { name: "TurboGames" },
  inout:              { name: "InOut Games" },
  galaxsys:           { name: "Galaxsys" },
  expanse:            { name: "Expanse" },
  // Live casino
  evolutionlive:             { name: "Evolution" },
  "pragmaticplaylive-eu":    { name: "Pragmatic Live" },
  "pragmaticplaylive-asia":  { name: "Pragmatic Live" },
  sagaming:           { name: "SA Gaming" },
  sexy:               { name: "Sexy Gaming" },
  yeebet:             { name: "YeeBet" },
  v8:                 { name: "V8 Poker" },
  dreamgaming:        { name: "Dream Gaming" },
  ezugi:              { name: "Ezugi" },
  // Sports / other
  betby:              { name: "BetBy" },
  // Gregmorn catalog slugs (scripts/sync-gregmorn-games.mjs slugifies the
  // feed's provider names). Shared slugs (jili, netent, habanero,
  // microgaming) reuse the entries above.
  "evolution-gaming": { name: "Evolution" },
  pragmatic:          { name: "Pragmatic Play" },
  "pg-soft":          { name: "PG Soft" },
  "play-ngo":         { name: "Play'n GO" },
  "3oaks":            { name: "3 Oaks" },
  amatic:             { name: "Amatic" },
  aristocrat:         { name: "Aristocrat" },
  novomatic:          { name: "Novomatic" },
  wazdan:             { name: "Wazdan" },
  egt:                { name: "EGT" },
  "egt-digital":      { name: "EGT Digital" },
  igt:                { name: "IGT" },
  inbet:              { name: "InBet" },
  apollo:             { name: "Apollo" },
  rubyplay:           { name: "RubyPlay" },
  hacksaw:            { name: "Hacksaw" },
  fishing:            { name: "Fishing" },
  algnet:             { name: "AlgNET" },
  quickspin:          { name: "Quickspin" },
  booming:            { name: "Booming Games" },
  bally:              { name: "Bally" },
  ainsworthanywhere:  { name: "Ainsworth" },
  vegas:              { name: "Vegas" },
  "vegas-bb":         { name: "Vegas BB" },
  igrosoft:           { name: "Igrosoft" },
  firekirin:          { name: "Fire Kirin" },
  wms:                { name: "WMS" },
  sg:                 { name: "SG" },
  royal:              { name: "Royal" },
  kajot:              { name: "Kajot" },
  egaming:            { name: "eGaming" },
  dlv:                { name: "DLV" },
  sgx:                { name: "SGX" },
  rplslots:           { name: "RPL Slots" },
  tomhorn:            { name: "Tom Horn" },
  agt:                { name: "AGT" },
  zitro:              { name: "Zitro" },
  vibragaming:        { name: "Vibra Gaming" },
  blueprintgaming:    { name: "Blueprint" },
  spinomenal:         { name: "Spinomenal" },
  fish:               { name: "Fish" },
  yggdrasil:          { name: "Yggdrasil" },
  "scientific-games": { name: "Scientific Games" },
};
