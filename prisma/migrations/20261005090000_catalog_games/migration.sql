-- CreateTable
CREATE TABLE "catalog_games" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "rawType" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "img" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "catalog_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_syncs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB,
    "unknownTypes" JSONB,
    "error" TEXT,

    CONSTRAINT "catalog_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_backups" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "gameCount" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_games_active_section_category_idx" ON "catalog_games"("active", "section", "category");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_games_source_externalId_key" ON "catalog_games"("source", "externalId");

-- CreateIndex
CREATE INDEX "catalog_syncs_source_startedAt_idx" ON "catalog_syncs"("source", "startedAt");

