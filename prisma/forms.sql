CREATE TABLE IF NOT EXISTS "WhatsAppForm" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  "destination" JSONB NOT NULL,
  "metaFlowId" TEXT UNIQUE,
  "published" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WhatsAppForm_accountId_createdAt_idx" ON "WhatsAppForm" ("accountId", "createdAt");
CREATE TABLE IF NOT EXISTS "WhatsAppFormInvite" (
  "id" TEXT PRIMARY KEY,
  "formId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "WhatsAppFormInvite_expiresAt_idx" ON "WhatsAppFormInvite" ("expiresAt");
CREATE TABLE IF NOT EXISTS "WhatsAppFormsHubSpot" (
  "id" TEXT PRIMARY KEY,
  "portalId" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL
);
