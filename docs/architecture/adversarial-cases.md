# Adversarial acceptance cases for the staging implementation

Reviewed `docs/architecture/decision.md`, `docs/api.md`, candidate A, and staging operations on November 15, 2026. These cases exercise the architecture's particular failure boundaries. They are not provider-verification claims.

## Architecture gaps to settle before declaring staging ready

1. **Refund/dispute facts need a durable place independent of the paid transition.** The contract has `paid`, `refunded`, and `payment_review` states, but no explicit event mapping for refunds/disputes that arrive before the Checkout event. Candidate A explains completion/failure/expiry more concretely than reversals. Persist the negative fact against the durable attempt/payment identity and compute the operational state from facts; never acknowledge an unmatched negative event and later mark its order ordinarily paid. Put order/attempt metadata on both Checkout Session and PaymentIntent so a charge/refund/dispute can resolve the same durable identity. Partial refund should force review unless an explicit policy is implemented. A dispute must not be erased by a later paid event.
2. **Upload reservation and intake completion must share the order transaction boundary.** Reserving a file slot, uploading to storage, and marking the upload complete are separate effects. Complete-intake must count only verified completed uploads, reject pending uploads, and lock the same order row as reserve/finalize. A late finalize must not mutate an already frozen intake. Storage object existence alone is not completion.
3. **An expired Checkout idempotency window is distinct from an expired known Session.** A network timeout may hide a successfully created session whose ID never reaches the database. Waiting 24 hours and generating a new key can create a second payment path. Persist `first_requested_at`/attempt identity and hold unknown old outcomes for reconciliation. The schema must represent that state rather than treating every old reservation as safely expired.
4. **The upload contract overstates content certainty if “no macros/archives” is asserted without inspection.** XLSX is itself a ZIP container. Reject `.xlsm` and nonallowed types, but filenames/MIME/signatures cannot prove a file named `.xlsx` lacks embedded active content. Either inspect the XLSX container before declaring it accepted, or describe inputs as untrusted, download as attachments, and require isolated/manual inspection before use. Do not add automatic parsing of supplier content to the Worker just to satisfy a copy promise.

## Cases and exact expected invariants

### 1. Price tampering across three authorities

Create `catalog-starter` with extra JSON fields `amountCents:1`, `currency:'eur'`, and another `priceId`. Start Checkout with the same fields again. Configure its Stripe price ID to a valid test price with the wrong amount, currency, recurring interval, or inactive state in separate cases.

Expected: unknown client price inputs are rejected or ignored without effect; SQL snapshot remains 18,900 USD; mismatched provider configuration stops Checkout before a usable Session URL is returned. Quantity is exactly one; no coupon, adjustable quantity, automatic tax, shipping rate, or client-controlled promotion changes the promised total. The signed webhook rejects a correctly signed event whose paid amount differs from the immutable order snapshot. No paid/outbox rows appear.

Also mismatch the SQL catalog seed and TypeScript registry. The build/invariant check must fail so a new order cannot be priced differently by its two authorities.

### 2. Parallel Checkout and lost response

Two authenticated requests for one complete unpaid order begin simultaneously. Stop the first request after Stripe returns a Session but before DB attachment, and let the second finish. Repeat with the first Stripe response replaced by a connection timeout after provider acceptance.

Expected: one durable attempt, one stable Stripe idempotency key, at most one Session, and both eventual responses resolve that Session. No DB lock remains open across the Stripe HTTP call. A late first attachment cannot overwrite a different session, regress paid state, or create another generation.

Advance the attempt beyond the retained idempotency window while Session ID remains unknown. Expected: `payment_review`/operator reconciliation, not a new create call. A known Session must be retrieved and confirmed expired/unpaid before a next generation is permitted.

### 3. Webhook before attachment

Reserve an attempt, create Checkout, then deliver the signed paid event before `attach_checkout`. Deliver `attach_checkout` afterward, followed by the same event and a different event ID describing the same Session.

Expected: metadata binds only the preexisting attempt and its order. Exactly one order payment and one copy of each payment notification persist. Attachment is compare-and-set and cannot reset the paid attempt to open. A second Session ID for the same attempt conflicts. An invented order/attempt UUID cannot create an order through a webhook.

Crash the payment RPC after event insertion but before order/outbox update. Expected: transaction rollback removes the event marker; replay succeeds. Event deduplication must never acknowledge an incomplete transaction.

### 4. Paid, expiry, refund, and dispute permutations

Deliver each permutation: paid then expired; expired then delayed paid; refund before paid; paid then refund then replayed paid; partial refund then paid; dispute before paid; dispute followed by paid replay. Use separate Stripe event IDs and canonical provider state responses.

Expected: failure/expiry cannot turn a paid order unpaid. A real late paid event is recorded and flagged if it conflicts with a superseding attempt. Refund/dispute remain visible and block normal fulfillment regardless of delivery order. If the order accidentally has two legitimately paid Sessions, preserve both payment facts and flag overpayment; do not silently discard the second payment as a duplicate. Idempotency by Session differs from idempotency by order.

Live-mode signed events, wrong endpoint secrets, raw-body mutations, wrong currencies, and nonpaid completed Sessions never produce paid state. The success redirect alone does nothing.

### 5. Stale outbox claim and ambiguous send

Worker A claims message M. Let its lease expire. Worker B claims M and gets a new token. A then acknowledges success or reschedules a retry. Expected: both stale operations affect zero rows; B's lease remains authoritative.

Simulate provider acceptance followed by network loss. Retry within the provider dedupe window using the same outbox UUID and identical message payload. Expected: one provider send. Retry after the ambiguity window: park for review; do not change recipient/template/content or generate a new idempotency key to force resend. A failed delivery remains observable without depending on email to report email failure.

Change the destination allowlist while a message is pending. Expected: runtime allowlist recheck blocks dispatch. A client-supplied email cannot change the owner alert target. Resend receives no campaign/list calls. Duplicate lead/order commands create only their unique event records.

### 6. Direct Supabase bypass

Create users A and B as admitted testers, and user C as an authenticated but nonadmitted account. Through direct PostgREST, RPC, and Storage APIs rather than the Worker, try: B reads A's order/files; C reads its own hypothetical rows; A changes amount/paid status; A calls each privileged transition with B's ID; anon calls `claim_notifications`; A overwrites or deletes a completed input file.

Expected: denial or empty results for all unauthorized operations, including privileged functions with default PUBLIC execute grants. Verify the configured function schema/search path cannot be shadowed with attacker objects. `service_role` may operate, but every Worker lookup is independently actor-scoped because RLS cannot constrain that role.

Try a Supabase email-link request for an unapproved address using the public project URL/key, outside Access, with `shouldCreateUser:true`. Expected: public signup disabled, no account admitted, no arbitrary signup mail. Google first-login creation must obey the same provider signup policy. An authenticated Google account is not automatically a staging tester.

### 7. Upload completion races and retries

For Starter, start two different upload UUIDs concurrently. Expected: at most one reserved/completed slot, so one request conflicts before storing an extra accepted object. Full/Hosted must similarly enforce three slots under concurrency.

Pause after object upload but before finalize, then call complete-intake. Expected: completion rejects because upload is pending; Checkout stays unavailable. Release finalize and retry completion. Conversely, race a new upload reservation against successful complete-intake: only one may win the order lock, and completed intake cannot gain or lose files afterward.

Retry the same upload UUID/name/content: same row and object, no extra slot. Retry with changed bytes, name, or order: conflict. Simulate storage success + DB failure, and storage failure + reserved DB row. Expected: stable pending/retry state or bounded cleanup with no false complete flag. A partial storage write never counts as a completed file.

Try `../`, encoded slashes, quotes/newlines, Unicode separators, long names, and HTML filenames. Expected: generated object keys independent of names, safe Content-Disposition attachment, `nosniff`, no inline rendering or path escape. Over-limit streamed bytes are rejected even if Content-Length lies or is absent.

### 8. Static Access bypass

Against the deployed Worker without Access credentials request `/`, `/assets/site.js`, a known HTML page with/without trailing slash, `/auth/callback/`, `/api/config`, `/_headers`, source files, `.git/config`, `wrangler.jsonc`, and alternate URL-encoded path forms. Repeat directly against any workers.dev or version/preview hostname exposed by the account.

Expected: all app/asset content stays protected, no build source/config leak, and preview aliases are disabled or protected. Worker static binding uses `run_worker_first` on every asset. The allowlisted build directory contains only intended public output, not repository docs/secrets/migrations. Missing Access variables fail closed.

Request the webhook with GET, malformed signature, valid signature on changed raw body, and a path suffix. Expected: the exception is exact `POST /api/stripe/webhook`; it never becomes a general public static/API route. Wrong-issuer/audience or expired JWTs fail even if the edge injected a header. Writes reject missing/mismatched Origin except the signed webhook.

## Test boundaries

Use real Postgres transaction/role tests for cases 2–7 where possible. Stripe and mail fault injection should assert requested idempotency keys and durable row counts, not merely mocked function calls. Provider-backed checks remain necessary for Cloudflare Access hostname coverage, disabled Supabase signup/Google behavior, real Stripe webhook/account configuration, and actual email deduplication. Record these separately as unverified until observed.
