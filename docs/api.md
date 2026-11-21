# Phase 1 staging contract

All routes require Cloudflare Access except `POST /api/stripe/webhook`, which requires a valid Stripe signature. All application writes require the exact configured Origin. Order routes also require a Supabase bearer token for an admitted staging tester. JSON error responses use `{error: string}` without provider payloads.

- `GET /api/config`: `{supabaseUrl, supabasePublishableKey, testMode: true, services: [{id,name,amountCents,currency,requiresFiles,maxFiles,maxProducts,purchasable}], audit: {engines,questionsPerEngine:20}}`.
- `POST /api/orders`: `{requestId: UUID, serviceId, intake: {businessName,website,services?,markets?,competitors?,notes?,productCount?,distributorCount?}, termsAccepted:true}`. AI requires services and markets. Catalog requires productCount. Hosted is displayed at $1,490 with purchasable=false; new Hosted intake and all Hosted Checkout attempts, including legacy orders, are rejected. GBP and Automation are email-only. Returns an OrderView. AI intake completes immediately; Catalog starts as draft for file upload.
- `GET /api/orders/:id`: OrderView `{id,serviceId,status,amountCents,currency,intakeCompletedAt,paidAt,dueDate,pendingFiles:[{name,bytes}],files:[{id,name,bytes}]}`. Status is draft, awaiting_payment, paid, refunded, or payment_review.
- `POST /api/orders/:id/files`: raw CSV or XLSX bytes, `X-File-Name: encodeURIComponent(file.name)`, `X-Upload-Id: UUID`, Content-Type. Limit 10 MiB per file, at most the package's file count (Starter 1; Full 3; no new Hosted orders). Returns `{id}`. Only CSV and XLSX extensions and declared media types are accepted. Files remain untrusted; no file content is executed or parsed. XLSX container inspection and malware scanning are not implemented, so operators must scan files before opening them. Reusing the upload UUID requires identical content and name.
- `POST /api/orders/:id/complete-intake`: `{}`. Requires uploaded files for Catalog; returns OrderView.
- `POST /api/orders/:id/checkout`: `{}`. Returns `{url}` for server-controlled Stripe test Checkout. No client amount or price input accepted.
- `GET /api/orders/:id/files/:fileId`: a private attachment response scoped to the signed-in owner.
- `POST /api/leads`: `{requestId: UUID,name,email,message,serviceId?}`. Creates one lead and Jay alert. It sends no message to the submitted email address. Returns `{received:true}`.
- `POST /api/stripe/webhook`: Stripe raw JSON and Stripe-Signature header. The redirect after Checkout never confirms a payment.

The browser uses Supabase's official SDK, PKCE, `signInWithOtp({options:{shouldCreateUser:false,emailRedirectTo: origin+'/auth/callback/'}})` and `signInWithOAuth({provider:'google',options:{redirectTo: origin+'/auth/callback/'}})`. Callback sends users back to their same-origin pending intake/order/admin route. No arbitrary redirect URL may be accepted. Staging setup must disable public signup and admit tester IDs separately in the database; those hosted settings are not yet verified.

## Runtime configuration

Runtime settings: `APP_ORIGIN`, `ACCESS_TEAM_DOMAIN` (team.cloudflareaccess.com), `ACCESS_AUD`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `STRIPE_PRICE_AI_AUDIT`, `STRIPE_PRICE_CATALOG_STARTER`, `STRIPE_PRICE_CATALOG_FULL`, `ALERT_EMAIL`, `EMAIL_FROM`, `STAGING_EMAIL_ALLOWLIST` (comma separated explicit addresses).

Store those settings together as the GitHub staging environment secret `STAGING_CONFIG_JSON` so tester addresses do not enter public source or CI logs. Deployment writes a temporary ignored configuration and removes it after use.

Runtime secrets: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (sk_test_ or rk_test_ only), `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Cloudflare deployment additionally needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Supabase migration tooling separately needs its staging database connection string. Secrets must be held in the GitHub staging environment and copied only into the required provider runtime secret stores.

Transactional application email uses Resend, pending confirmation of an existing verified sender. It never sends to a recipient outside `STAGING_EMAIL_ALLOWLIST`; Jay's alert address must be included. Supabase and Stripe own their sign-in emails and receipts. The outbox handles lead alerts, payment confirmations/alerts, report-ready notices and two-way order-message notices, with a bounded retry window and manual review for ambiguous old sends.

## Staging deployment trigger

The feature-branch workflow runs checks on push and PR. It deploys only a push to `codex/phase1-protected-staging` in this exact repository whose head commit message contains `[deploy staging]`, after checks pass and the GitHub `staging` environment permits it. Review pushes must omit that marker. This works before the workflow reaches the default branch, so no release merge is required. An environment reviewer can provide an additional provider-change approval gate.

The deploy script rejects live Stripe keys, missing Access settings, production domains, asset bypasses, and misplaced browser secrets before any provider command. It deploys only `calvinsonit-staging`, then installs the four runtime secrets. The Worker denies unprotected requests throughout. CLI output is captured rather than printed; temporary configuration, secret JSON, and logs are deleted. Configure the separate Supabase project, Access application, provider SMTP, and Stripe test webhook first. No DNS changes or paid plan purchases are part of the workflow.

Checkout attempts snapshot their Stripe price ID before the first provider call. Retry bodies and signed payment reconciliation use that snapshot even if future configured price IDs change. Provider idempotency cannot be assumed after 23 hours, so uncertain attempts are held for operator review.

## Order fulfilment (November 21 extension)

- `GET /api/orders/:id/workspace`: owner-only `{order:OrderView,fulfilmentStatus:'pending'|'ready',intake:null,clientEmail:null,paymentIntent:null,paymentUrl:null,reports:[{id,name,bytes}],messages:[{id,senderRole,body,createdAt}]}`. Only confirmed reports are listed. Messages are returned as plain data and rendered with textContent.
- `POST /api/orders/:id/messages`: `{requestId:UUID,body:string}` (trimmed, 1–3000 characters). The verified session fixes sender identity and client role; no role, email, recipient or owner input is accepted. Returns `{id}`. The admitted operator's alert email receives an outbox notice with a protected admin link, without the message body.
- `GET /api/orders/:id/reports/:fileId`: owner-only report attachment streamed through the Worker, scoped to both order and uploaded report ID. Never returns a public or signed Storage URL.
- `GET /api/admin/orders?offset=0`: admin-only list, newest first, 50 per page. Each row includes ID, service, payment status, fulfilment status, due date, client email and creation time.
- `GET /api/admin/orders/:id` or `/workspace`: admin detail including intake, input files, reports and messages. Only admins receive client email/intake and a validated `https://dashboard.stripe.com/test/payments/pi_…` link derived from the saved payment intent; no new payment is created. Dates and payment status remain controlled by the existing payment/intake logic.
- `GET /api/admin/orders/:id/files/:fileId` or `/reports/:fileId`: admin-only private input/report attachment, scoped to the order and uploaded file ID.
- `POST /api/admin/orders/:id/reports`: raw PDF, CSV, XLSX or ZIP, `X-File-Name` encoded as above, `X-Upload-Id:UUID` and matching Content-Type. Nonempty, at most 10 MiB; basic PDF/ZIP signatures and UTF-8 CSV checks. No execution or malware scanning. Maximum 20 report reservations per order. Requires a verified paid order. Upload uses private `order-reports`, no upsert. Matching stored bytes recover an ambiguous upload. Confirmation atomically sets fulfilment to ready and queues one client notice per report. Same upload ID requires matching metadata/content; matching content/name by the same admin also reuses a report after browser reload.
- `POST /api/admin/orders/:id/messages`: same schema as client messages; database-backed admin membership fixes the admin role and owner email destination. One transactional notice is queued for the order owner.

The database checks order ownership/admission and admin membership again inside privileged RPCs. `staging_admins`, `order_reports` and `order_messages` have RLS enabled and no authenticated/anonymous table grants; all new RPCs are service-role-only. Report Storage has no direct browser policies. Admin membership is provisioned by the staging operator, never by a browser claim, email match, signup, or user metadata. Removing membership revokes admin access while retaining upload history.

Message retries are unique on order, verified sender and request ID and compare body/role. They are limited to 20 new messages per sender per hour across orders. Durable outbox dedupe and the existing Resend idempotency key/lease rules cover all new notices. Beyond the 23-hour ambiguity window, manual review is required. Report-ready sends recheck paid status; failed or forbidden sends remain retryable or held in the outbox. Actual provider delivery remains unverified.

`STRIPE_PRICE_CATALOG_HOSTED` is a legacy optional setting accepted for compatibility; it has no purchase-enabling effect. Only the other three test price IDs are required. No new runtime secret was added for fulfilment.
