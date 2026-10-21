import { CATEGORY_LABEL, SECTION_CATEGORIES, classify, slugify } from "../../src/providers/classify";

// The old site's classifier tests, kept so the port behaves exactly the same.
describe("classify: Octhera type → site section", () => {
  it.each([
    ["Slots", "Sweet Bonanza", "casino", "slots"],
    ["Video Slot", "Book of Dead", "casino", "slots"],
    ["Casino Live", "Lightning Roulette", "casino", "live"],
    ["live_dealer", "Speed Baccarat", "casino", "live"],
    ["Table Games", "European Roulette", "casino", "table"],
    ["Card", "Teen Patti", "casino", "table"],
    ["Crash", "Aviator", "games", "crash"],
    ["Instant Win", "Mines", "games", "crash"],
    ["Mini Games", "Plinko", "games", "crash"],
    ["Fishing", "Ocean King", "games", "fishing"],
    ["Shooting", "Fish Hunter", "games", "fishing"],
    ["Lottery", "Lucky Draw", "games", "lottery"],
    ["Keno", "Keno 80", "games", "lottery"],
    ["Scratch Cards", "Gold Scratch", "games", "lottery"],
    ["Arcade", "Pixel Run", "games", "arcade"],
    ["Sportsbook", "Sportsbook", "sports", "sportsbook"],
    ["Sports", "Live Betting", "sports", "sportsbook"],
    ["Virtual Sports", "Virtual Football", "sports", "virtual"],
    ["eSports", "CS2 Betting", "sports", "esports"],
  ])("%s / %s → %s · %s", (type, name, section, category) => {
    expect(classify(type, name)).toEqual({ section, category, known: true });
  });

  it("a vague type falls back to the name", () => {
    expect(classify("Casino", "Aviator")).toMatchObject({ section: "games", category: "crash" });
    expect(classify("Casino", "Auto Roulette")).toMatchObject({ section: "casino", category: "table" });
    expect(classify("", "Live Blackjack")).toMatchObject({ section: "casino", category: "live" });
    expect(classify("Casino", "Sweet Fortune")).toMatchObject({ section: "casino", category: "slots" });
  });

  it("a type nothing explains goes to Games → More Games, flagged unknown", () => {
    expect(classify("Specialty", "Wonder Wheel Deluxe")).toEqual({
      section: "games",
      category: "other",
      known: false,
    });
    expect(classify(undefined, "Something")).toEqual({ section: "games", category: "other", known: false });
  });
});

describe("labels and slugs", () => {
  it("labels every category and slugifies provider names", () => {
    expect(CATEGORY_LABEL.crash).toBe("Crash & Instant");
    expect(Object.keys(SECTION_CATEGORIES)).toEqual(["casino", "games", "sports"]);
    expect(slugify("Pragmatic Play")).toBe("pragmatic-play");
    expect(slugify(" BNG(3oks) ")).toBe("bng-3oks");
  });
  it("reads a live game by name when the type is vague, but not live betting", () => {
    expect(classify("Casino", "Live Roulette")).toMatchObject({ category: "live" });
    expect(classify("Casino", "Live Bet Wheel")).toMatchObject({ section: "casino", category: "slots" });
    expect(classify(null, null)).toEqual({ section: "games", category: "other", known: false });
    expect(classify("Casino", "Keno Lucky")).toMatchObject({ category: "lottery" });
    expect(classify("Casino", "Fishing God")).toMatchObject({ category: "fishing" });
  });
});
