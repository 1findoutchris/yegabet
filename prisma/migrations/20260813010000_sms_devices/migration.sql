-- Admin kill switch per OTP handset. Absent row = enabled, so this table
-- starts empty and every configured phone keeps sending.
CREATE TABLE "sms_devices" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_devices_pkey" PRIMARY KEY ("id")
);
