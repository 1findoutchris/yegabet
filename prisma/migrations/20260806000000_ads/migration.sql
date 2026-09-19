-- Image-only advertisement slots (lobby board + popup), admin-managed.
CREATE TABLE "ads" (
    "id"        TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "imageKey"  TEXT NOT NULL,
    "linkUrl"   TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ads_placement_isActive_expiresAt_idx" ON "ads"("placement", "isActive", "expiresAt");
