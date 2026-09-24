-- Bet-slip detail on ticket bets: provider game uid + raw provider extras
-- (Gregmorn `info` / Silent `data`) so printed tickets can show what was
-- actually bet on.
ALTER TABLE "ticket_bets" ADD COLUMN "gameId" TEXT;
ALTER TABLE "ticket_bets" ADD COLUMN "info" JSONB;
