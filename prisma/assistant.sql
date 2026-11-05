-- Additive PostgreSQL assistant tables. Apply after waba.sql; safe to re-run.
-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAssistantConfig" (
    "accountId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAssistantConfig_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAssistantSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "handover" BOOLEAN NOT NULL DEFAULT false,
    "lockUntil" TIMESTAMP(3),
    "lockToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppLead" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppBookingSlot" (
    "serviceId" TEXT NOT NULL DEFAULT 'default',
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "bookingId" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppBookingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppBooking" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "mode" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentCancellationQueued" BOOLEAN NOT NULL DEFAULT false,
    "paymentReference" TEXT,
    "paymentUrl" TEXT,
    "paymentId" TEXT,
    "meetingUrl" TEXT,
    "calendarId" TEXT,
    "calendarSynced" BOOLEAN NOT NULL DEFAULT false,
    "reminderQueued" BOOLEAN NOT NULL DEFAULT false,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAssistantJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT,
    "phone" TEXT,
    "payload" JSONB NOT NULL,
    "plan" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAssistantJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAssistantDelivery" (
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "metaMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAssistantDelivery_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAiUsage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WhatsAppAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAssistantSession_accountId_phone_key" ON "WhatsAppAssistantSession"("accountId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppLead_sourceId_key" ON "WhatsAppLead"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppLead_accountId_createdAt_idx" ON "WhatsAppLead"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppBookingSlot_accountId_startsAt_reservedUntil_idx" ON "WhatsAppBookingSlot"("accountId", "startsAt", "reservedUntil");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBookingSlot_accountId_startsAt_key" ON "WhatsAppBookingSlot"("accountId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBooking_paymentId_key" ON "WhatsAppBooking"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBooking_sourceId_key" ON "WhatsAppBooking"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppBooking_accountId_status_startsAt_idx" ON "WhatsAppBooking"("accountId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAssistantJob_key_key" ON "WhatsAppAssistantJob"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppAssistantJob_status_availableAt_idx" ON "WhatsAppAssistantJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppAssistantDelivery_accountId_status_idx" ON "WhatsAppAssistantDelivery"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAiUsage_accountId_day_key" ON "WhatsAppAiUsage"("accountId", "day");
