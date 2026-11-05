# waba-app

Reusable WhatsApp Business module: shared inbox, business AI assistant, menus, lead capture, booking holds, verified payments, human handover, templates, campaigns and Embedded Signup.

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
2. Merge the Prisma models and run `prisma/waba.sql` followed by `prisma/assistant.sql` (additive, no drops).
3. Copy `.env.example` keys into the host `.env`. Set a **public HTTPS** `WABA_WEBHOOK_URL`.
4. At API boot, follow `src/examples/express-mount.ts`:
   - `setWabaAdapters({ prisma, requireAdmin, getAudiencePhones })`
   - save `rawBody` on `/api/whatsapp/webhook`
   - mount `/api/admin/waba` and `/api/whatsapp/webhook`
   - run `processAssistantJobs()` every 2–5 seconds in an always-on worker
   - cron `processWhatsAppQueue()` every minute
5. Add an admin page that renders `WabaBoard` (`src/examples/nextjs-admin-page.tsx`).
6. From order/lead/warranty handlers call `triggerWhatsAppFlow(triggerType, { phone, name, orderId, total })`.

Meta App ID, App Secret, verify token, and access token are entered in the **Connect Meta** tab. They live in `WhatsAppAccount`. Do not put them in git.

## Live demo

[Open the Wabix AI demo](https://wabix-ai-demo.netlify.app). Try the customer chat, create a workflow and add a message step, or switch among 45 sample numbers. Demo changes are stored in the browser. For a real installation, use **WhatsApp numbers → Add a number**, configure Meta in **Settings**, then open **AI assistant** for business knowledge, menus and booking setup. **Analytics** reports messages, delivery, leads and bookings for the selected number.

Existing installs upgrading to v1.1.0 must rerun the updated `prisma/waba.sql` and apply `prisma/assistant.sql` or use equivalent host Prisma migrations. The updated base SQL replaces the global template ID index so numbers under the same Meta business account can each sync their shared templates.

## Business assistant

Read the [complete integration and operating guide](docs/ASSISTANT.md) before enabling automation. The **AI assistant** screen provides business setup, knowledge, leads, booking management, handover and diagnostics. Automation starts disabled in test mode; add allowlisted test phones first. AI, payments and Google Calendar are optional server-configured integrations. Production activation and credentials remain the host business’s responsibility.

Use `src/examples/assistant-adapters.ts` for Razorpay and Google Calendar wiring. Existing host apps must merge the new Prisma models, regenerate their client, apply the new tables and run the worker. Configure the host's Tailwind content scan to include these components. Admin auth is required; Meta signatures fail closed, so raw-body capture and App Secret are mandatory for inbound webhooks.

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

## Updating installed apps

Open **Settings → App updates** to see the installed version and the latest stable release from [GitHub](https://github.com/chandan539/waba-app/releases). **Update app** sends the selected release to the host's deployment system. Connect that system once per installation through `WABA_UPDATE_HOOK_URL` and `WABA_UPDATE_HOOK_TOKEN`, or pass an `updateWaba` callback to `mountWaba`. The installed version changes when the new build is running.

The HTTPS hook receives `repository`, `version`, `tag`, `commit`, `archiveUrl`, and `releaseUrl` as JSON, with a bearer token and an `Idempotency-Key` header. Authenticate the hook and deduplicate requests by key. Have the pipeline fetch the supplied commit from the WABA repository, update the vendored module or submodule, merge any new Prisma models, apply migrations, and build and deploy the host app. For a submodule, run `scripts/update-waba-submodule.sh SUBMODULE_PATH RELEASE_COMMIT` in the host CI checkout to fetch the exact SHA and stage the updated pointer. For copied source, stage the archive and update only the WABA module files and migration inputs. Keep host customizations outside the vendored directory. Return 2xx once the deployment is queued and keep deployment logs in the host system. Use the previous deployed host build and module revision if you need to roll back.

To ship a new version, run `npm version X.Y.Z --no-git-tag-version`, set the same version in `src/lib/wabaVersion.json`, commit, and push the matching `vX.Y.Z` tag. The release workflow checks both version files and publishes the GitHub release after the checks pass. Installed apps discover published stable releases. A commit pushed to the default branch becomes available when you publish its version.

## Shared inbox numbers and attachments

Use **Shared inbox → Business number** to show all connected numbers or one number. The conversation list and thread show the receiving number. When a customer contacts more than one business number, their threads remain separate and replies use the number shown in the thread. Use Previous and Next to browse 25 contacts at a time. Search and Unread apply across all pages for the chosen numbers. Open a conversation and click Load older messages to retrieve the full stored thread in batches of 50. The inbox applies no date cutoff to stored history. The all-numbers view also shows read-only archived conversations for messages stored without a number assignment or under a former number. Chats that were never received or imported are outside the app’s stored history.

WhatsApp media with a Meta media ID can be downloaded for up to 24 hours from the message timestamp, subject to availability from Meta. The protected download endpoint streams the file directly from Meta without writing it to disk or storing the file in PostgreSQL. The inbox stops serving the attachment after 24 hours. Message records and attachment metadata remain in history. Shared WhatsApp contacts appear as cards with the name, company, phone numbers and email addresses supplied by the sender.
