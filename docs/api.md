# Phase 1 staging contract

All routes require Cloudflare Access except `POST /api/stripe/webhook`, which requires a valid Stripe signature. All application writes require the exact configured Origin. Order routes also require a Supabase bearer token for an admitted staging tester. JSON error responses use `{error: string}` without provider payloads.

- `GET /api/config`: `{supabaseUrl, supabasePublishableKey, testMode: true, services: [{id,name,amountCents,currency,requiresFiles,maxFiles}], audit: {engines,questionsPerEngine:20}}`.
- `POST /api/orders`: `{requestId: UUID, serviceId, intake: {businessName,website,services?,markets?,competitors?,notes?,productCount?,distributorCount?}, termsAccepted:true}`. AI requires services and markets. Catalog requires productCount; Hosted also requires distributorCount. Returns an OrderView. AI intake completes immediately; Catalog starts as draft for file upload.
- `GET /api/orders/:id`: OrderView `{id,serviceId,status,amountCents,currency,intakeCompletedAt,paidAt,dueDate,pendingFiles:[{name,bytes}],files:[{id,name,bytes}]}`. Status is draft, awaiting_payment, paid, refunded, or payment_review.
- `POST /api/orders/:id/files`: raw CSV or XLSX bytes, `X-File-Name: encodeURIComponent(file.name)`, `X-Upload-Id: UUID`, Content-Type. Limit 10 MiB per file, at most the package's file count (Starter 1; Full/Hosted 3). Returns `{id}`. Only CSV and XLSX extensions and declared media types are accepted. Files remain untrusted; no file content is executed or parsed. XLSX container inspection and malware scanning are not implemented, so operators must scan files before opening them. Reusing the upload UUID requires identical content and name.
- `POST /api/orders/:id/complete-intake`: `{}`. Requires uploaded files for Catalog; returns OrderView.
- `POST /api/orders/:id/checkout`: `{}`. Returns `{url}` for server-controlled Stripe test Checkout. No client amount or price input accepted.
- `GET /api/orders/:id/files/:fileId`: a private attachment response scoped to the signed-in owner.
- `POST /api/leads`: `{requestId: UUID,name,email,message,serviceId?}`. Creates one lead and Jay alert. It sends no message to the submitted email address. Returns `{received:true}`.
- `POST /api/stripe/webhook`: Stripe raw JSON and Stripe-Signature header. The redirect after Checkout never confirms a payment.

The browser uses Supabase's official SDK, PKCE, `signInWithOtp({options:{shouldCreateUser:false,emailRedirectTo: origin+'/auth/callback/'}})` and `signInWithOAuth({provider:'google',options:{redirectTo: origin+'/auth/callback/'}})`. Callback sends users back to their same-origin pending intake/order route. No arbitrary redirect URL may be accepted. Staging setup must disable public signup and admit tester IDs separately in the database; those hosted settings are not yet verified.

## Runtime configuration

Runtime settings: `APP_ORIGIN`, `ACCESS_TEAM_DOMAIN` (team.cloudflareaccess.com), `ACCESS_AUD`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `STRIPE_PRICE_AI_AUDIT`, `STRIPE_PRICE_CATALOG_STARTER`, `STRIPE_PRICE_CATALOG_FULL`, `STRIPE_PRICE_CATALOG_HOSTED`, `ALERT_EMAIL`, `EMAIL_FROM`, `STAGING_EMAIL_ALLOWLIST` (comma separated explicit addresses).

Store those settings together as the GitHub staging environment secret `STAGING_CONFIG_JSON` so tester addresses do not enter public source or CI logs. Deployment writes a temporary ignored configuration and removes it after use.

Runtime secrets: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (sk_test_ or rk_test_ only), `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Cloudflare deployment additionally needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Supabase migration tooling separately needs its staging database connection string. Secrets must be held in the GitHub staging environment and copied only into the required provider runtime secret stores.

Transactional application email uses Resend, pending confirmation of an existing verified sender. It never sends to a recipient outside `STAGING_EMAIL_ALLOWLIST`; Jay's alert address must be included. Supabase and Stripe own their sign-in emails and receipts. The outbox handles lead alerts and payment confirmations/alerts, with a bounded retry window and manual review for ambiguous old sends.

## Staging deployment trigger

The feature-branch workflow runs checks on push and PR. It deploys only a push to `codex/phase1-protected-staging` in this exact repository whose head commit message contains `[deploy staging]`, after checks pass and the GitHub `staging` environment permits it. Review pushes must omit that marker. This works before the workflow reaches the default branch, so no release merge is required. An environment reviewer can provide an additional provider-change approval gate.

The deploy script rejects live Stripe keys, missing Access settings, production domains, asset bypasses, and misplaced browser secrets before any provider command. It deploys only `calvinsonit-staging`, then installs the four runtime secrets. The Worker denies unprotected requests throughout. CLI output is captured rather than printed; temporary configuration, secret JSON, and logs are deleted. Configure the separate Supabase project, Access application, provider SMTP, and Stripe test webhook first. No DNS changes or paid plan purchases are part of the workflow.

Checkout attempts snapshot their Stripe price ID before the first provider call. Retry bodies and signed payment reconciliation use that snapshot even if future configured price IDs change. Provider idempotency cannot be assumed after 23 hours, so uncertain attempts are held for operator review.
