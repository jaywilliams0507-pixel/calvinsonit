# CalvinsonIT protected staging

Phase 1 adds service intake, private Catalog input files, managed Supabase sign-in, Stripe test Checkout, durable payment confirmation, and transactional alerts to the pending frontend release. The public site remains unchanged until a separately approved production cutover.

Builds run in the cloud against this GitHub repository. Keys belong in GitHub environment secrets and scoped runtime secret stores. This project has no Mac dependency.

## Local cloud verification

Use Node 24 and Docker. Install with `npm ci`, then run:

```sh
npm run check
npm run test:db
npm run test:browser
```

The database suite starts an isolated PostgreSQL 17 container and tests transaction, role, RLS, and retry behavior using Supabase-compatible auth/storage schema fixtures. It does not prove hosted Supabase settings. Browser tests use the built static artifact with mocked provider APIs and Chromium; they do not prove real payment, sign-in, email, or Access configuration. They prefer `/usr/bin/chromium` when available, otherwise Playwright's installed Chromium.

The Worker intentionally has no local authentication bypass. A default `wrangler dev` request fails closed because only the configured protected workers.dev origin is admitted. Use the browser fixtures for UI development, then verify the actual protected staging environment before approval.

For a deployment bundle check without a provider mutation:

```sh
npx wrangler deploy --dry-run --outdir /tmp/calvinsonit-worker-bundle
```

In restricted cloud environments, point Wrangler's log and XDG configuration paths at task-owned writable temporary directories. Do not change HOME or disable TLS verification.

## Configuration and operations

See [API and configuration](docs/api.md), [staging operations](docs/staging-operations.md), [architecture decision](docs/architecture/decision.md), and [work plan](docs/staging-work-plan.md). No provider access is configured by the source files. Placeholder configuration denies requests.

The staging workflow performs checks on ordinary pushes. Deployment additionally requires the exact staging branch, the explicit `[deploy staging]` head-commit marker, the GitHub `staging` environment, and its secrets. Do not add that marker to a review-only push. The pipeline never targets production or changes DNS, repository visibility, the pending-release branch, or the live Stripe account.

## Deliberate limits

There is one owned order receipt page, not the Phase 2 portal. There is no custom authentication, admin dashboard, marketing subsystem, Telegram integration, live-payment switch, or generic file execution. CSV/XLSX inputs remain untrusted and need operator malware checks before opening. No automatic retention-deletion job is implemented; the stated retention policy needs an operator procedure before production. Hosted Build terms, holiday treatment, and provider/account settings remain production gates.
