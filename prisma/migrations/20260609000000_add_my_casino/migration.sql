-- AlterTable
ALTER TABLE "users" ADD COLUMN     "streakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "recent_games" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 1,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_games" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recent_games_userId_lastPlayedAt_idx" ON "recent_games"("userId", "lastPlayedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recent_games_userId_gameId_key" ON "recent_games"("userId", "gameId");

-- CreateIndex
CREATE INDEX "favorite_games_userId_idx" ON "favorite_games"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_games_userId_gameId_key" ON "favorite_games"("userId", "gameId");

-- AddForeignKey
ALTER TABLE "recent_games" ADD CONSTRAINT "recent_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_games" ADD CONSTRAINT "favorite_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
