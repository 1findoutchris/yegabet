export interface Game {
  gameID: string;
  gameNameEn: string;
  img: string;
  customGameType: number;
  vendorCode: string | number;
  provider: string;
}

// The Betby sportsbook launches through the shared game-launch endpoint, but it
// is not a casino game — exclude it from recently-played / recommendations.
export const SPORTSBOOK_GAME_UID = "8a704858d5deb4af1ddc722092ac7614";

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
};
