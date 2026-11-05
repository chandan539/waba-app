-- Additive Postgres. Safe to re-run. Does not drop rows.

CREATE TABLE IF NOT EXISTS "WhatsAppAccount" (
  "id" TEXT NOT NULL,
  "isSelected" BOOLEAN NOT NULL DEFAULT false,
  "metaAppId" TEXT,
  "metaAppSecret" TEXT,
  "embeddedSignupConfigId" TEXT,
  "wabaId" TEXT,
  "phoneNumberId" TEXT,
  "businessId" TEXT,
  "accessToken" TEXT,
  "verifyToken" TEXT,
  "displayName" TEXT,
  "displayPhone" TEXT,
  "qualityRating" TEXT,
  "connectedAt" TIMESTAMP(3),
  "lastWebhookAt" TIMESTAMP(3),
  "lastWebhookFields" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppTemplate" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "metaId" TEXT,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "category" TEXT NOT NULL DEFAULT 'UTILITY',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "bodyText" TEXT NOT NULL,
  "components" JSONB,
  "variableKeys" JSONB,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);
DROP INDEX IF EXISTS "WhatsAppTemplate_metaId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_accountId_metaId_key" ON "WhatsAppTemplate"("accountId", "metaId");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_accountId_idx" ON "WhatsAppTemplate"("accountId");

CREATE TABLE IF NOT EXISTS "WhatsAppCampaign" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "name" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'ORDERS',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhatsAppCampaign_accountId_idx" ON "WhatsAppCampaign"("accountId");

CREATE TABLE IF NOT EXISTS "WhatsAppQueue" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "phone" TEXT NOT NULL,
  "userId" TEXT,
  "userEmail" TEXT,
  "campaignId" TEXT,
  "flowStepId" TEXT,
  "templateName" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "params" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "errorLogs" TEXT,
  "metaMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppQueue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhatsAppQueue_accountId_idx" ON "WhatsAppQueue"("accountId");
CREATE INDEX IF NOT EXISTS "WhatsAppQueue_status_scheduledFor_idx" ON "WhatsAppQueue"("status", "scheduledFor");

CREATE TABLE IF NOT EXISTS "WhatsAppContact" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "phone" TEXT NOT NULL,
  "displayName" TEXT,
  "lastMessage" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "optedOut" BOOLEAN NOT NULL DEFAULT false,
  "optedOutAt" TIMESTAMP(3),
  "lastInboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppContact_accountId_phone_key" ON "WhatsAppContact"("accountId", "phone");
CREATE INDEX IF NOT EXISTS "WhatsAppContact_accountId_lastMessageAt_idx" ON "WhatsAppContact"("accountId", "lastMessageAt");

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "phone" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'text',
  "body" TEXT NOT NULL,
  "templateName" TEXT,
  "metaMessageId" TEXT,
  "status" TEXT,
  "contactName" TEXT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_metaMessageId_key" ON "WhatsAppMessage"("metaMessageId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_accountId_phone_createdAt_idx" ON "WhatsAppMessage"("accountId", "phone", "createdAt");

CREATE TABLE IF NOT EXISTS "WhatsAppFlow" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "name" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppFlow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhatsAppFlow_accountId_triggerType_idx" ON "WhatsAppFlow"("accountId", "triggerType");

CREATE TABLE IF NOT EXISTS "WhatsAppFlowStep" (
  "id" TEXT NOT NULL,
  "flowId" TEXT NOT NULL,
  "sequenceOrder" INTEGER NOT NULL DEFAULT 1,
  "delayHours" INTEGER NOT NULL DEFAULT 0,
  "templateName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppFlowStep_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppQueue" ADD CONSTRAINT "WhatsAppQueue_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "WhatsAppCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppFlowStep" ADD CONSTRAINT "WhatsAppFlowStep_flowId_fkey"
    FOREIGN KEY ("flowId") REFERENCES "WhatsAppFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
