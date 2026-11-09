# Add Wabix to a host app using Cursor

Copy the instructions below into Cursor in the host repository.

---

Integrate the WhatsApp module from `https://github.com/chandan539/waba-app`. Read its **Add Wabix to another app** section in `README.md`, `.env.example`, and `docs/ASSISTANT.md`. Use a pinned Git dependency or submodule. If vendoring is required, copy the complete `src/` and `prisma/` directories.

- Merge every Wabix Prisma model, regenerate Prisma Client, and apply the additive migrations. Preserve existing WhatsApp rows and other host data.
- Use `mountWaba(app, { prisma, requireAdmin })` for Express. Mount before general JSON middleware so Meta signatures use the original bytes. If this host uses a different server, wire the same routers, admin authorization, raw-body handling, and background jobs.
- Render `WabaModule` on a protected admin page for new installations. For an existing installation, keep its board and enable Channels with `<WabaBoard channels />` when requested. Pass the API base and authenticated Axios client through `WabaModule` or `WabaHost` as needed. Include the Wabix components in the Tailwind source scan.
- Configure this host's public HTTPS webhook URL and exact Meta OAuth callback. The callback must render the board. Enter Meta credentials and Embedded Signup configuration ID in Wabix **Settings**. Keep credentials out of Git and confirm signature validation and delivery with an inbound test message.
- Reuse the host's authenticated admin middleware and wire optional audience lookup, event triggers, AI, payments, and calendar through Wabix's adapters. Run the assistant and queue workers in an always-on process. Keep the assistant in test mode until configured and verified.
- Submit the three test templates only through the explicit admin action. Confirm the existing inbox, templates, automation, campaigns, analytics, and update settings are available in the host.
