# Wabix app updates

## Enable updates on each host

An installation needs a deployment path that can rebuild and restart its own backend and frontend. For an older installation with a disabled **Update app** button, deploy the latest Wabix release once through your normal host pipeline. Apply any outstanding schema migrations, including `prisma/forms.sql` for Forms, and regenerate Prisma Client.

Configure `WABA_UPDATE_HOOK_URL` and `WABA_UPDATE_HOOK_TOKEN` on the host API, or supply an `updateWaba` adapter when calling `mountWaba`. The hook receives an authenticated POST containing the stable tag, exact commit, and a stable `Idempotency-Key` header. Have it queue your host deployment and deduplicate requests while a deployment for that commit is in progress. Return a successful HTTP status after accepting the deployment request.

The host deployment should update its Wabix dependency or submodule to the supplied commit, apply required migrations, rebuild, and restart the API and admin UI. For a Git submodule, see `scripts/update-waba-submodule.sh`. Confirm the new version under **Settings → App updates** after deployment.

## Update notices and automatic updates

The Wabix workspace shows an in-app notice when GitHub publishes a newer stable release. It checks when the workspace opens and every 30 minutes while it stays open.

Set `WABA_AUTO_UPDATE=true` on the host API, or pass `autoUpdateWaba: true` to `mountWaba`, to automatically send stable releases to the configured deployment hook. With workers enabled, the server checks at startup and every 30 minutes even when the admin app is closed. It stores the update request in the existing job queue. On deployments with external workers, schedule `checkWabaAutoUpdate()` in the worker process and run `processAssistantJobs()` there. Both require the Wabix adapters and database.

An accepted deployment request appears in Settings. The installed version changes once the new backend is running. If the host deployment failed after accepting the request, use **Update app** to submit it again after resolving the failure.
