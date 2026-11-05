# Reusable WhatsApp business assistant

This module stays inside the host React + Express + PostgreSQL/Prisma application. It does not require a second Python service. Each WhatsApp number has independent settings, knowledge, leads, sessions and bookings. It is a module for one trusted host workspace, not a tenant authorization system: the host's admin middleware must restrict who can administer all connected numbers. For a multi-tenant SaaS, mount isolated adapters/instances or add tenant authorization before sharing this router.

## Install in an existing app

1. Copy `src/` and merge **all** models from `prisma/schema.prisma` into the host schema. Keep the host's datasource and generator. Use PostgreSQL.
2. Install runtime dependencies: `npm install axios express lucide-react react sharp qrcode node-cron`. Node 20.19+ is required. Keep your existing Prisma client and run `prisma generate` after merging models. The example TypeScript uses `@types/express`, `@types/node`, `@types/react` and `@types/qrcode`.
3. Apply a host Prisma migration, or run `prisma/waba.sql` followed by `prisma/assistant.sql`. Both SQL files are additive and rerunnable. Do not apply both SQL and a duplicate generated migration without reconciling the host migration history.
4. Include `src/components/**/*.tsx` in the host's Tailwind source/content scan. Provide Tailwind CSS and a system font or Inter. Mount `WabaBoard` on your protected admin page.
5. Follow `src/examples/express-mount.ts`. Supply **both** `prisma` and a real `requireAdmin` middleware. Missing auth fails closed. Use the host's CSRF protection for cookie-authenticated write routes. This middleware must authorize the entire workspace.
6. Mount the module before the host's existing JSON parser. Signature checks require the exact request bytes in `req.rawBody`; the example captures them for the webhook and its payment subpath. Do not parse this path first with another middleware.
7. Configure public `WABA_WEBHOOK_URL`, Meta connection settings and the new server secrets from `.env.example`.
8. Run `processAssistantJobs()` every 2–5 seconds in an always-on process. Run `processWhatsAppQueue()` every minute. The mount example does both and returns a cleanup function. A serverless host needs a separate worker; do not start an unreliable timer in a request handler. Multiple workers use database leases. Monitor failed jobs.

## Business setup

Open **AI assistant → Setup**. Initially automation is disabled, in TEST mode, with AI and booking disabled. Add the business name, IANA timezone, business hours, languages and a welcome message disclosing that replies are AI-assisted. Customize the six menu labels. Add public HTTPS URLs for an optional welcome banner, PDF guide and rate-card image.

The menu supports enquiries, booking, guide delivery, waitlist, business questions and human handover. Enquiries collect a brief in one message; waitlist capture validates the email. Captured information remains in PostgreSQL and can optionally sync to your CRM with `onLead`. Tell customers what information is stored and maintain an appropriate business privacy notice.

Add approved FAQs, prices and policies in **Knowledge**. Set `ANTHROPIC_API_KEY` on the server and choose a model available to that API account using the model field or `CLAUDE_MODEL`. No model names or historical prices from the reference PDF are assumed. AI is limited to business answers and interpreting booking requests; it cannot confirm payment, reserve slots, execute arbitrary tools, or change settings. Unknown/error cases hand over to staff. History is bounded to 12 text messages, output to 700 tokens and the per-number AI request budget resets on UTC days. Provider spend limits should also be configured.

Add allowlisted phones with country codes and enable TEST mode. Test `hi`, the menu items, an enquiry, a waitlist email, a business question and `human`. Menu taps do not call Claude. Only allowlisted numbers receive test automation. TEST booking tickets say DEMO, do not collect payment and never create a real calendar event. Slot holds still exercise the database and expire after ten minutes.

Switch to LIVE deliberately after testing. No templates are automatically submitted. The existing Templates screen offers just three explicit test examples; their event flows start paused. Existing Meta templates are preserved.

## Booking and payments

Configure the default session name, optional additional session types, integer price in currency minor units (10000 = INR 100.00), currency and available slots in **Bookings**. Assign each slot to a session type; save session settings before adding its slots. Customers choose a session before selecting a slot. The module's own calendar is authoritative for these slots. Each slot accepts one reservation. Overlapping administrative slots are serialized per account; atomic slot claims prevent two customers taking the same slot. Customer-visible times use the configured timezone; datetime inputs use the administrator's device timezone.

The menu shows real stored availability. With Google Calendar configured, busy slots are filtered and rechecked before a hold. Free LIVE bookings are confirmed immediately. Paid LIVE bookings hold the slot for ten minutes and return a provider payment link. A payment claim, screenshot or “I've paid” message never confirms a booking. Configure both `createPayment` and `verifyPaymentWebhook` before enabling paid LIVE bookings.

Payment endpoint: `<WABA_WEBHOOK_URL>/payments/razorpay`. Subscribe to `payment_link.paid`. The included Razorpay adapter verifies HMAC against the raw body, re-fetches payment and link, and requires captured payment, matching amount/currency and the same provider link reference. Duplicate notifications are idempotent. Razorpay requires a minimum link expiry beyond the ten-minute booking hold, so its links use a 16-minute provider expiry and the worker cancels unpaid links when the ten-minute hold expires. A delayed worker or cancellation failure can leave a short interval in which a late payment is possible; such payments require review/refund rather than confirming a released slot. Custom providers should implement `cancelPayment` too. Invalid signatures are rejected. A payment arriving after hold expiry is not auto-booked: the endpoint returns 409 for operator review/refund, and the provider may retry. Monitor provider webhook failures; payment refunds and rescheduling are manual operations in this version.

`createPayment` and calendar/CRM callbacks must honour their idempotency key. The Razorpay example recovers links using a unique `reference_id`; Google Calendar uses a deterministic event ID. Configure real Razorpay keys only on a production host. Module TEST mode never invokes these providers. To exercise Razorpay's sandbox end-to-end, use a separate staging workspace in LIVE mode with sandbox credentials and staging-only phone numbers.

After verified payment, a durable job creates the optional Google Calendar event and sends a confirmation. External calendars can change between availability checks; a conflict after payment leaves a failed job for staff to resolve, never an invented meeting. Google Meet creation is optional and requires the authorized calendar to support it. No attendee email invitation is sent by the built-in adapter; confirmation goes through WhatsApp.

Set `WABA_MEDIA_SIGNING_SECRET` to a random secret and ensure the configured webhook base is publicly reachable. This enables actual PNG booking tickets and payment QR images. Media links expire in 24 hours and are bearer links: avoid logging their query strings. QR images open the provider-hosted checkout; they are not proof of payment. Without media configuration, customers receive text tickets/payment links.

Optional reminders: create an approved template yourself and put its name in Booking settings. Supported named variables include `name`, `bookingId`, `date`, `time`. A reminder is scheduled within one hour of the appointment and always uses an approved template. Late worker startup does not send reminders after the appointment. Confirmations outside the 24-hour service window are marked SKIPPED; use an approved template manually. Opt-outs block all automatic sends.

## Human takeover

Customers can choose Talk to a human or type `human`. The assistant sends an acknowledgement, records handover and stops its replies. Staff see handovers in the admin screen and can reply from Shared inbox. Resume is an explicit admin action and applies to future messages. Handover pauses the conversational assistant; operational booking confirmations/reminders and separately enabled event/campaign flows are independent. Disable those separately if your business needs a total communication stop. STOP opt-out blocks messaging globally for that contact.

The optional `onHandover` adapter notifies the host team. This module does not send staff emails, Slack messages or other external notifications unless the host explicitly wires that adapter.

## Durability, diagnostics and data

Signed Meta webhook payloads are persisted before HTTP acknowledgement, with a hash-based deduplication key. The worker stores inbound messages, deduplicates by Meta message ID and enqueues conversation jobs. History imports and outbound echoes never trigger bot replies. Replies use the receiving number's exact account, not the globally selected number. Unknown accounts and missing/invalid signatures are rejected. Database failure returns an error so Meta can retry.

Jobs have leases, bounded exponential retries and failed-state visibility. Conversations have leases to prevent simultaneous state changes. Lead state transitions and their reply plan are checkpointed together. Calendar and CRM calls are at-least-once and must be idempotent. Delivery intents are recorded before calling WhatsApp. A crash/network timeout can leave an unknown external send outcome, so these deliveries require operator review rather than blind replay. Exactly-once external delivery is not promised. Failed job retries are available when there is no ambiguous delivery.

**Diagnostics** shows readiness, job attempts/errors and deliveries needing review. Service-window/opt-out skips are recorded. Inspect the customer inbox before a manual replacement. Global failed webhook jobs have no number assigned until parsing and can be inspected by the workspace administrator; correct the cause and requeue them through a trusted database/operations tool.

The host owns retention, backups, data export/deletion and secret encryption. Settings and credentials must never be returned from a public unauthenticated endpoint. This module stores Meta credentials in the host database as the existing module does; use database encryption/access controls or adapt secret storage for your deployment. No Anthropic, Razorpay or Google secret is stored in browser settings. Deleting a WhatsApp account removes its assistant data too.

## Provider wiring

See `src/examples/assistant-adapters.ts`. The included providers are optional. Other payment systems, calendars, CRMs and notification systems can implement `AssistantAdapters`. Their credentials must be scoped by the host: the included example represents one business, not independent calendars/payment accounts for every tenant.

## Verification

```bash
npm install
npm run check
# UI fixture checks (install Chromium first, or supply PLAYWRIGHT_CHROME_PATH):
npx playwright install chromium
npm run test:ui
# Integration suite uses a disposable PostgreSQL database whose name starts waba_test:
TEST_DATABASE_URL=postgresql://USER@localhost:5432/waba_test_assistant node scripts/prepare-test-db.mjs
TEST_DATABASE_URL=postgresql://USER@localhost:5432/waba_test_assistant npm run check
```

The integration suite deletes data in that disposable database. Without TEST_DATABASE_URL those tests are explicitly skipped. Tests mock external WhatsApp/Claude/payment/calendar calls: they do not prove that your own Meta approvals, credentials, model access, payment account or calendar authorization are working. Before production, perform a real end-to-end test in a staging workspace, then test each production integration with controlled business-owned recipients.

Voice-note transcription, image understanding, Instagram DMs and daily owner summaries remain optional future extensions. Rescheduling/refunds, multiple staff calendars and arbitrary user-authored flow trees are not built into this core release.

## Primary API references

- Claude Messages / business answer generation: https://platform.claude.com/docs/en/api/messages
- Meta interactive list messages: https://www.postman.com/meta/whatsapp-business-platform/request/r3ufenw/send-list-message
- Razorpay Payment Links: https://razorpay.com/docs/api/payments/payment-links/create-standard
- Razorpay webhook signatures: https://razorpay.com/docs/webhooks/validate-test
- Google Calendar availability: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google Calendar events: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
