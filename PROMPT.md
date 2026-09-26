# Prompt — add WhatsApp Cloud API (WABA) to this app

Copy everything below the line into Cursor in the **target web app**. Point it at this repo.

---

Implement the portable WhatsApp Cloud API module from `https://github.com/chandan539/waba-app`. Copy the source into this project. Do not invent a new WhatsApp stack. Do not commit `.env`, tokens, App Secrets, or System User tokens.

## What to ship

1. Admin page `/admin/waba` with tabs: Inbox, Flows, Templates, Campaigns, Connect Meta.
2. Public webhook `GET+POST /api/whatsapp/webhook` that Meta can reach over HTTPS.
3. Admin API under `/api/admin/waba` (settings, Embedded Signup, manual token connect, templates, campaigns, inbox reply, flows).
4. Prisma models from `prisma/schema.prisma` (or run `prisma/waba.sql` additively).
5. Event templates `txn_*` submitted as UTILITY, then queued when the host app fires the same trigger types as email (ORDER_PLACED, ORDER_SHIPPED, etc.).
6. Minute cron that calls `processWhatsAppQueue()`.

## Copy these files

- `src/lib/config.ts`, `adapters.ts`, `waba.ts`, `wabaSignup.ts`, `wabaFlags.ts`, `wabaService.ts`, `cn.ts`
- `src/routes/waba.ts`, `wabaPublic.ts`
- `src/components/WabaBoard.tsx`, `WabaInbox.tsx`, `WabaFlows.tsx`
- `src/examples/express-mount.ts` and `nextjs-admin-page.tsx`
- `prisma/schema.prisma` + `prisma/waba.sql`

Wire at API boot with `setWabaAdapters({ prisma, requireAdmin, getAudiencePhones })`. Mount JSON with `rawBody` saved only on paths that include `whatsapp/webhook`.

## Env (no secrets in git)

```
WABA_WEBHOOK_URL=https://<public-api-host>/api/whatsapp/webhook
WABA_BRAND=<brand name>
WABA_SHOP_URL=https://<shop-host>
WABA_ADMIN_ORIGIN=https://<admin-host>
WABA_API_ORIGIN=https://<public-api-host>
WABA_DEFAULT_CC=91
WABA_GRAPH_VERSION=v26.0
```

Meta App ID, App Secret, verify token, and Cloud API access token are saved in `WhatsAppAccount` from the admin Connect tab. Never hardcode them.

## Host hooks you must add

- `requireAdmin` — same auth as other admin routes.
- `getAudiencePhones(audience)` — return `{ phone, userEmail }[]` for `ORDERS`, `LEADS`, or `BOTH`.
- After checkout / ship / deliver / quote / warranty, call:

```ts
await triggerWhatsAppFlow('ORDER_PLACED', {
  phone: order.contactPhone,
  name: order.contactName,
  email: order.contactEmail,
  orderId: order.orderNumber,
  total: String(order.total),
})
```

Only APPROVED templates send. If the template is still PENDING, the flow logs `WABA_FLOW_SKIP` and waits.

## Meta console (required for inbound)

Inbound is webhook-only. Cloud API has no pull inbox.

1. Facebook app → WhatsApp → Configuration.
2. Callback URL = `WABA_WEBHOOK_URL`. Verify token = the token stored on `WhatsAppAccount`.
3. Subscribe field `messages` (plus template status + account_update). Do **not** subscribe `message_echoes` (Meta permission error).
4. Subscribe the WABA with `POST /{waba-id}/subscribed_apps`.
5. Do **not** set a phone-number `override_callback_uri`. Phone override beats the app callback and often black-holes inbound.
6. App Mode must be **Live** for real customer numbers. Dev mode often delivers only testers / the Meta test `+1 555` number.
7. In API Setup, select the **production Cloud API number**, not Meta’s test number.
8. Add admin + API hosts to App Domains and Valid OAuth Redirect URIs: `https://<admin-host>/admin/waba`.

## Hard rules learned from production

- `GET /admin/waba` must call `maintainWabaConnection(false)`, never `force=true`. Re-POSTing `/{app-id}/subscriptions` on every page load makes Meta re-verify and drop inbound POSTs.
- Subscribe app webhooks only when callback URL or field list actually changed.
- Keep `rawBody` for `x-hub-signature-256`. If the payload is a WhatsApp `entry` object and HMAC fails, still apply it (log `WABA_WEBHOOK_BAD_SIGNATURE`). Only 403 unsigned empty probes.
- Parse `value.messages`, `message_echoes`, and `history`. If `from` is missing, fall back to `contacts[0].wa_id`.
- Free-text reply only for 24 hours after last inbound. Otherwise send an APPROVED template.
- Template send must fill every `{{n}}` from `variableKeys` (`#132000` if a body param is missing).
- Never include `message_echoes` in the subscribe field list.
- Do not change offer-letter / legal copy in the host app. This module is WhatsApp only.

## Done when

- Admin Connect shows Cloud API CONNECTED for the real business number.
- `Submit all event templates` creates 11 `txn_*` rows (some may be recategorized MARKETING by Meta).
- A personal WhatsApp can message the business number and the thread appears in Inbox within a few seconds.
- Outbound template + 24h free reply both store in `WhatsAppMessage`.
- Order/event code calls `triggerWhatsAppFlow` and the queue sends after Meta approves the template.

---
