# Independent staging security and correctness review

Reviewed November 15, 2026 (Eastern), against the working tree based on `release/legal-buyer-fixes`. Read `AGENTS.md`, the API contract, adversarial cases, the Worker/access/domain/config/database/order/payment/notification modules, migration, Wrangler configuration, and build/deploy validators. No source edits, provider changes, Git mutations, or real emails/payments were performed.

## Findings

### Resolved P2: a replacement Stripe price prevented confirmation of an existing paid Checkout

Location: `src/payments.ts:78`.

The webhook compares a paid Session's line-item price ID to the current `STRIPE_PRICE_*` environment variable. If an operator replaces a test price with another price for the same approved amount while an earlier Checkout remains open, the old Session still collects the correct amount but its signed completion event returns HTTP 400 forever. The order stays unpaid and payment notifications are never queued. Replays after the configuration change have the same failure.

Reproduced using a real locally generated Stripe test signature, the current bundled `acceptWebhook`, and mocked provider HTTP responses: canonical paid Session with the correct order/attempt/amount/currency, line item `price_original`, configured value `price_replacement` produced `{status:400,message:"Payment does not match the order",paymentRecorded:false}`. No external calls were made.

Fix verified: `checkout_attempts.stripe_price_id` is now persisted by `reserve_checkout` before Stripe is contacted. An existing attempt retains that saved price even when runtime configuration changes. Checkout retries, webhook line-item verification, and the payment RPC all use the saved value. The new signed paid-session regression with `price_original` and configured `price_replacement` passed. The replay-body/idempotency-key test also passed after runtime price replacement. Finding resolved.

### Resolved P1: a successful upload followed by failed database confirmation could not recover

Original location: `src/orders.ts:34`; current fix is lines 34–36.

The original recovery branch accepted only HTTP 409. Supabase documents HTTP 400 `Asset Already Exists` for duplicate standard uploads. Thus a Storage success followed by `confirm_file` failure left a pending file that every retry rejected. A focused current-code reproduction returned HTTP 503 without confirming the file.

The implementation owner replaced status-only acceptance with an existing-object readback and exact byte length/SHA-256 verification. This handles an ambiguous upload outcome while rejecting a different existing object. Independent rerun `npx vitest run tests/provider-retries.test.ts` passed all four tests, including the documented 400 duplicate and mismatched-byte rejection. Finding resolved.

Source: https://supabase.com/docs/guides/storage/uploads/standard-uploads

## Boundaries reviewed without another finding

- Access JWT issuer/audience/algorithm/required-claim checks and fail-closed static asset routing; exact signed webhook exception.
- Supabase managed `getUser` validation, verified email allowlist and tester membership, owned order/file queries, RLS and privileged RPC revocations.
- Public Supabase configuration rejects service-role/secret keys.
- Durable Checkout reservation and unknown-outcome cutoff; webhook-before-attachment binding; duplicate event/session handling; refund/dispute holds.
- Immutable intake completion and order-locked upload reservations; completed-file read isolation.
- Outbox lease tokens, retry cutoff, staging recipient allowlist, fixed transactional templates.
- Static output selection and staging-only Wrangler configuration.

This is a bounded code review, not a claim that all vulnerabilities are absent. The review used available Codex tooling, not pstack's unavailable cross-vendor judges.

## Still unverified with providers

Cloudflare Access hostname coverage, configured Supabase signup/Google/email-link/Storage behavior, the actual Stripe test account and webhook endpoint, and actual Resend delivery/deduplication remain provider acceptance gates. No provider credentials were available to this reviewer. The PostgreSQL test harness approximates Supabase auth/storage schemas; it does not replace hosted-provider tests.

## Final recheck, including deployment

No unresolved actionable findings remain in this bounded code review.

Independently reran:

- `npx vitest run tests/provider-retries.test.ts tests/deployment.test.ts`: 9 tests passed, including signed paid-session price rotation, stable Checkout retry identity, upload recovery, and deployment configuration rejection cases.
- `npm run test:db`: 14 PostgreSQL 17 checks passed in a separate temporary Docker container, including concurrency, RLS, RPC restrictions, event retry, refund ordering, private-file ownership, and stale outbox claims.

Reviewed the added `src/deployment.ts`, `.github/workflows/staging.yml`, current Wrangler config, and `.gitignore`:

- Deploy job requires a push to the exact repository and staging branch with the explicit `[deploy staging]` commit marker; pull-request checks cannot deploy. The check job receives no deployment secrets.
- Configuration rejects production hostnames/routes, extra Wrangler environments, preview URLs, static-asset bypass, live Stripe keys, misplaced Supabase server keys in browser configuration, missing Access values, and unapproved alert recipients before invoking Wrangler.
- Runtime still validates Access independently, so an absent edge Access application does not expose app content. Actual Access configuration remains a provider gate.
- Secrets are scoped to the deploy step, written to ignored files with mode 0600, passed through the runtime secret store, and removed in `finally`. Wrangler stdout/stderr is captured rather than printed. Its log path is explicit and removed; inspected the installed Wrangler implementation to confirm a `.log` path is treated as a file.
- Only the fixed `calvinsonit-staging` Worker is targeted. No migration, DNS operation, custom-domain route, repository visibility change, production deployment target, or live Stripe API operation is in this deployment flow.

This recheck did not execute a provider deployment. Matching the supplied Supabase project and Cloudflare account to the intended separate staging resources still requires provider verification. A successful upload followed by failed secret provisioning can leave staging temporarily unavailable; the script reports failure rather than claiming full deployment success. The application remains fail closed.
