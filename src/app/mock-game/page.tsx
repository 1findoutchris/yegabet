/*
 * Placeholder rendered inside game/sportsbook iframes when SILENT_API_LIVE is
 * off. launchGame() returns this URL instead of billing the provider — keeps
 * the launch flow (auth, iframe mount, sizing) testable without real calls.
 */
export default function MockGamePage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "#0b0b0f",
        color: "#a1a1aa",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 40 }}>🎰</div>
      <MockedGameNote searchParams={searchParams} />
      <p style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.6 }}>
        This is a mocked game launch — no provider API call was made.
        Set <code style={{ color: "#fbbf24" }}>SILENT_API_LIVE=true</code> to
        load the real game / sportsbook.
      </p>
    </div>
  );
}

async function MockedGameNote({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  return (
    <p style={{ fontSize: 15, fontWeight: 700, color: "#e4e4e7" }}>
      Mocked launch{game ? ` — ${game.slice(0, 12)}…` : ""}
    </p>
  );
}
