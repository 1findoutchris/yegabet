-- Homepage promotions placed between lobby game sections (see HomePromo).
CREATE TABLE "home_promos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "heading" TEXT,
    "description" TEXT,
    "imageKey" TEXT,
    "mobileImageKey" TEXT,
    "imageAlt" TEXT,
    "ctaLabel" TEXT,
    "destType" TEXT NOT NULL DEFAULT 'internal',
    "destUrl" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'banner',
    "slot" TEXT NOT NULL DEFAULT 'after_first',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_promos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "home_promos_slot_isActive_idx" ON "home_promos"("slot", "isActive");
