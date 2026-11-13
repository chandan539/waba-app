# WhatsApp Forms

Wabix publishes native WhatsApp Flows to Meta and receives completed forms on the existing signed WhatsApp messages webhook. Keep the assistant worker running to deliver submissions.

## Update an installed app

Apply the additive `prisma/forms.sql` migration and merge the three new models from `prisma/schema.prisma` into the host Prisma schema. Regenerate Prisma Client and deploy the backend and admin UI from the same release. If your deployment hook runs those steps, use **Settings → App updates → Update app**. A host that vendors Wabix needs to copy the new files and apply the migration through its own release process.

## Connect HubSpot

1. Create a HubSpot OAuth app with required scope `crm.objects.contacts.write`. Add `forms` as an optional scope if you want to submit to HubSpot Forms.
2. Register the exact HTTPS admin page URL including `?wabix_hubspot=1`. Set `WABA_HUBSPOT_REDIRECT_URI` to that URL. Route the admin UI and Wabix API through the same origin so the OAuth state cookie can be checked.
3. Set `WABA_HUBSPOT_CLIENT_ID`, `WABA_HUBSPOT_CLIENT_SECRET`, and `WABA_HUBSPOT_TOKEN_KEY` on the server. Generate the encryption key with `openssl rand -hex 32` and retain it for later deployments.
4. In Wabix, open **Forms → Connect HubSpot**, choose your HubSpot portal, and authorize access.

Each Wabix installation uses one HubSpot portal at a time. Existing forms keep the portal they were saved against.

## Create and test a form

Select a connected WhatsApp account, open **Forms**, and add up to ten text, email or phone fields. Set the destination and map each field to a destination key. Save the draft and publish it to Meta. To change a published form, create a new draft.

- **HubSpot contact** requires an email field mapped to `email`. Map other answers to HubSpot contact properties such as `firstname` and `phone`.
- **HubSpot form** requires the form ID in the connected portal and the optional Forms permission. Use the internal names of fields already defined on that form.
- **Webhook** uses the server's `WABA_FORMS_WEBHOOK_URL` and `WABA_FORMS_WEBHOOK_TOKEN`. Wabix POSTs JSON with `submissionId`, `formId`, and mapped `fields`. Verify the bearer token and deduplicate on `submissionId` before creating records.

Have a test recipient message the business number, then send the published form from Wabix within the 24-hour reply window. Submit it on WhatsApp and check **Recent deliveries**. This release supports forms sent from Wabix during that window. Sending through approved Flow templates outside the window requires additional support for tracking those invitations.

The worker retries delivery failures. HubSpot contact upserts match on email. HubSpot Forms can show a repeated submission if HubSpot accepts a request and the response is lost before Wabix records success. Use contact upserts or a deduplicating webhook when that distinction matters.
