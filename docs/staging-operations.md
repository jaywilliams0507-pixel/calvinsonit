# Protected staging operations

This runbook is for a separate staging environment. Production remains on GitHub Pages until Jay approves the final diff and cutover. No DNS, live Stripe, production hosting, repository visibility, or pending-release merge is part of this work.

## Current provider state

No Cloudflare, Supabase, Stripe, email-provider, DNS, or hosting settings have been changed by this task. The cloud environment has no provider credentials or outbound identities. The GitHub connection can read and clone the repository, but its repository-secrets endpoint returned HTTP 403. A protected provider preview is therefore not yet verified.

## Provisioning order

1. Identify the Cloudflare account and its workers.dev subdomain. Create a staging Worker and an Access application for its exact hostname. Allow only named testers. Verify the Access JWT issuer and audience. Do not add a route on calvinsonit.org, its www hostname, or any other live hostname. Why: the preview must require identity before any HTML or asset is served.
2. Create or select a separate Supabase staging project. Apply the reviewed migration there. Enable email links and Google with the staging callback only. Disable public signups and precreate the test users. Configure custom SMTP only after a verified transactional sender is available. Why: staging data, account settings, and sign-in emails must not affect production or arbitrary recipients.
3. Select a Stripe test account or sandbox and create four test prices at 29900, 18900, 59000, and 149000 USD cents. Keep receipts enabled. Create a test webhook for the staging endpoint. Do not select a live key or change live receipt settings. Why: public price text and server-side billing must agree without charging a real customer.
4. Configure transactional email with a confirmed alert recipient, an existing verified sender, and a staging recipient allowlist. No sender-domain DNS changes are authorized here. Why: receipt, sign-in, lead, and order emails are permitted; campaigns and marketing are not.
5. Put credentials in the repository's `staging` GitHub environment, then provision only the needed runtime secrets to the staging Worker and Supabase. Restrict that environment to the staging branch. Why: the source repository and build artifacts must contain no credentials.
6. Deploy the reviewed staging commit and verify the anonymous-denial, authenticated-flow, two-client isolation, signed-webhook retry, private-file, and email-delivery checks. Record actual URLs and provider resource IDs after creation. Why: unit tests cannot prove provider configuration.

## Production approval packet

Before requesting production approval, provide:

- The reviewed PR and exact deployable commit, based on `release/legal-buyer-fixes`.
- A protected preview URL with actual evidence of Access, Supabase sign-in, test Checkout, webhook reconciliation, private files, and transactional email.
- Every created or changed provider resource, including its account and environment.
- The final fixed-price copy, AI scope and delivery promise, privacy terms, and remaining Hosted Build terms decision.
- Monthly baseline and metered costs, the Cloudflare/GitHub Pages cutover steps, and rollback steps.
- A separate, explicit repository-private step at cutover. Repository visibility stays unchanged now.

## Cost boundary

Budget planning remains approximately $40/month for Cloudflare Workers Paid and Supabase production plus separate staging, plus payment and metered usage. This is a planning allowance, not a purchased subscription or confirmed invoice. Transactional email provider charges, taxes, storage/egress, excess compute, and test-project plan eligibility must be confirmed before purchase. No recurring paid resource has been created by this task.

## Rollback

Before cutover, rollback means disabling or deleting the staging Worker and its schedule, disabling the staging Stripe webhook, revoking the staging runtime credentials, and pausing staging email sends. Preserve the database and payment-event log for reconciliation; never erase an event ledger as a first response. GitHub Pages remains the live host.

A future production rollback must first pause checkout, preserve every paid order, and reconcile Stripe events. Restoring a static site must not silently restore the old direct payment link. Restore the last approved Worker version for application regressions. DNS reversion, if later approved, requires an explicit checkout-disabled static artifact and retained webhook processing until all in-flight payments are resolved.

## GitHub environment configuration

Use a GitHub environment named `staging`, restricted to `codex/phase1-protected-staging` until a different reviewed staging branch is approved. Do not put credentials in repository variables, workflow YAML, `.env` committed to Git, comments, screenshots, build logs, or chat.

| GitHub secret | Destination and purpose |
| --- | --- |
| `STAGING_CONFIG_JSON` | Runtime settings from the API contract, including private tester addresses; written only to an ignored temporary configuration. |
| `CLOUDFLARE_API_TOKEN` | Deployment job only; token scoped to the approved account and Worker operations. Never send it to the browser or Worker runtime. |
| `CLOUDFLARE_ACCOUNT_ID` | Deployment job account selector. |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Worker runtime only; privileged database/storage calls. |
| `STRIPE_SECRET_KEY` | Staging Worker runtime only; `sk_test_` or `rk_test_`, verified test account. |
| `STRIPE_WEBHOOK_SECRET` | Staging Worker runtime only; the staging test endpoint's signing secret. |
| `RESEND_API_KEY` | Staging Worker runtime only; least-privilege sending access. |
| `SUPABASE_STAGING_DATABASE_URL` | Manual migration job only, if that deployment method is selected. Confirm the target project before any migration. |

The browser-safe configuration consists of Supabase's project URL and publishable key plus the four service definitions. The service-role key, Stripe key, email key, and webhook secret are never public configuration. An API key's label is not enough: only the publishable/anonymous Supabase key belongs in the client.

The settings stored in `STAGING_CONFIG_JSON` are `APP_ORIGIN`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, the four `STRIPE_PRICE_*` IDs listed in [the API contract](api.md), `ALERT_EMAIL`, `EMAIL_FROM`, and `STAGING_EMAIL_ALLOWLIST`. Keep the entire JSON in a GitHub environment secret so personal test email addresses stay out of public source and logs. The sender must already be verified, and every permitted custom-mail recipient must appear in the allowlist.

Do not assume a GitHub secret is automatically available to Cloudflare or Supabase. The deployment must copy only the four necessary runtime secrets to the named staging Worker; Supabase SMTP/OAuth secrets remain in Supabase's managed settings, with their recovery values in the approved secret store. Configure the Google OAuth client against Supabase's exact callback and allow only the staging application callback in Supabase redirect settings. Do not add wildcard production redirects.

## Acceptance evidence to collect

| Check | Required observation |
| --- | --- |
| Preview protection | Anonymous requests to `/`, a service page, an asset, callback, config, and order API are denied or sent to Access login. An expired or wrong-audience Access JWT is rejected. |
| Provider sign-in | Each of two precreated testers completes both the permitted email-link or Google flow; outside users cannot register or trigger business-data access. |
| Fixed checkout | Each package shows the approved USD test price; request-body changes cannot select another price, currency, or amount. |
| Payment confirmation | Stripe test payment yields exactly one paid order and its expected outbox entries; a browser success URL alone leaves it pending. |
| Retry safety | Duplicate webhook and concurrent Checkout requests do not duplicate fulfilment; an old ambiguous attempt is held for reconciliation. |
| Client isolation | Tester B cannot read A's order, private input, or state through the Worker, direct PostgREST, RPC, or Storage API. |
| Intake completion | Missing required fields/files prevent Checkout; completed intake cannot be replaced during payment. |
| Email limits | Only the explicitly allowed testers and Jay receive transaction messages. A disallowed recipient is blocked. No campaign or list is created. |
| Failure handling | Failed sends remain visible for retry/review; expired leases recover and stale acknowledgements cannot mark a newer lease sent. |
| Audit deadline | Weekend and Eastern DST cases produce five subsequent weekdays only after payment plus complete intake. |
| Live safety | No custom domain route, live key, live price, live checkout, DNS change, Pages deployment, or release merge occurred. |

Local passing tests are evidence for code behavior only. Record provider verification separately with resource identifiers, observed times in Eastern, and redacted results. Avoid storing email bodies, client files, token-bearing URLs, or secrets in public test artifacts.

## Executing the reviewed staging deployment

Ordinary pushes run checks only. After account selection, provider setup and the GitHub staging secrets are verified, an explicit head commit containing `[deploy staging]` on the exact `codex/phase1-protected-staging` branch triggers the deployment job. A review push must omit this marker. This deliberate trigger works before the workflow is merged into the default branch.

The job reruns checks, validates the staging hostname, Access configuration and test-only secrets, writes temporary files with owner-only permissions, uploads only `calvinsonit-staging`, and sets its four runtime secrets. It captures provider output and deletes temporary config, secret, and log files. It does not run database migrations or provision Access, OAuth, Stripe prices, SMTP, DNS, subscriptions, or production infrastructure. Those setup steps must be completed in the separate approved staging accounts first. See [the configuration contract](api.md).

No commit in this review contains the deployment marker. No deployment job has been requested.
