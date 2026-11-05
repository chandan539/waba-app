# waba-app

Portable WhatsApp Cloud API module: inbox, UTILITY event templates, flows, campaigns, Embedded Signup, and the Meta webhook.

Copy this folder into another Node/Express + React admin app. It is not a full shop. It is only the WhatsApp module that already works in production.

**Repo:** https://github.com/chandan539/waba-app

## What you get

| Area | Files |
| --- | --- |
| Config + host wiring | `src/lib/config.ts`, `src/lib/adapters.ts` |
| Cloud API + inbox + queue | `src/lib/waba.ts`, `src/lib/wabaService.ts` |
| Embedded Signup v4 | `src/lib/wabaSignup.ts` |
| Admin API | `src/routes/waba.ts` |
| Public webhook | `src/routes/wabaPublic.ts` |
| Admin UI | `src/components/WabaBoard.tsx`, `WabaInbox.tsx`, `WabaFlows.tsx` |
| Database | `prisma/schema.prisma`, `prisma/waba.sql` |
| Paste-into-Cursor prompt | [`PROMPT.md`](./PROMPT.md) |

## Add it to another app

```bash
git clone https://github.com/chandan539/waba-app.git
```

1. Copy `src/` and `prisma/` into the host repo (or add this repo as a git submodule).
2. Merge the Prisma models and run `prisma/waba.sql` (additive, no drops).
3. Copy `.env.example` keys into the host `.env`. Set a **public HTTPS** `WABA_WEBHOOK_URL`.
4. At API boot, follow `src/examples/express-mount.ts`:
   - `setWabaAdapters({ prisma, requireAdmin, getAudiencePhones })`
   - save `rawBody` on `/api/whatsapp/webhook`
   - mount `/api/admin/waba` and `/api/whatsapp/webhook`
   - cron `processWhatsAppQueue()` every minute
5. Add an admin page that renders `WabaBoard` (`src/examples/nextjs-admin-page.tsx`).
6. From order/lead/warranty handlers call `triggerWhatsAppFlow(triggerType, { phone, name, orderId, total })`.

Meta App ID, App Secret, verify token, and access token are entered in the **Connect Meta** tab. They live in `WhatsAppAccount`. Do not put them in git.

## Event templates

`EVENT_WABA_TEMPLATES` in `src/lib/waba.ts` contains only three UTILITY test examples: account ready, order confirmation, and shipping update. Click **Add 3 test templates** to submit them for Meta review. Connection maintenance no longer submits templates automatically. Example flows are created paused and are never automatically reactivated. Enable them deliberately after testing. Brand and shop host come from `WABA_BRAND` and `WABA_SHOP_URL`.

Previously submitted templates and existing flows are preserved; remove unwanted templates in WhatsApp Manager and pause unwanted flows in Automation. Local template deletion does not delete the remote Meta template.
Triggers: `ACCOUNT_CREATED`, `ORDER_PLACED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`, `ABANDONED_CART`, `REORDER_FOLLOWUP`, `COD_PAYMENT_FOLLOWUP`, `QUOTATION_FOLLOWUP`, `MANUAL_SALE_CUSTOMER`, `WARRANTY_REGISTER`, `WARRANTY_ACTIVATED`.

## Inbound inbox

Meta POSTs to the webhook. There is no Cloud API “list chats” endpoint.

If the inbox stays empty while outbound works:

1. App mode **Live** (Dev mode often skips real customer numbers).
2. Callback URL exactly `WABA_WEBHOOK_URL`, `messages` subscribed.
3. No phone-number webhook override.
4. Do not re-subscribe the app on every admin page load.
5. Customer must reply to the **production** Cloud API number, not Meta’s `+1 555` test line.

## Prompt for another Cursor chat

Open [`PROMPT.md`](./PROMPT.md), copy the block under the line, paste it in the other app’s Cursor chat.

## License

MIT
