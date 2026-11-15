# Candidate A: one Worker, transactional order core

## Worklist

- [x] Ground the static release and accepted staging scope.
- [x] Sketch the boundary and data ownership.
- [x] Agree: no human checkpoint requested for this candidate.
- [ ] Implement: parent chooses and synthesizes candidates first.
- [ ] Scrap if implementation disproves the boundary.

## Problem

The release is static HTML plus decorative JavaScript, with a live Stripe payment link on the audit page, Catalog Starter mailto buttons, and no API, forms, account state, or data storage. Existing pages should keep their appearance. The new backend must make paid orders traceable without treating a successful browser redirect as payment proof. Staging must be protected before deployment and incapable of accepting live Stripe credentials. No DNS, production, visibility, or live-site mutation is authorized.

## Usage: caller's view

A visitor enters the Cloudflare Access protected preview, chooses one of four fixed packages, signs in through Supabase email links or Google, completes the package intake, and opens Stripe test Checkout. Returning to `/order/?id=...` displays only the persisted order confirmation. It says payment is pending until the signed webhook commits it. No Phase 2 dashboard is required.

```ts
const order = await orders.submitIntake(actor, requestId, {
  service: 'ai-audit',
  businessName: 'Example Plumbing',
  website: 'https://example.com',
  market: 'United States',
  customerQuestions: ['Who repairs water heaters?'],
  notes: 'Residential customers'
});
const checkout = await payments.checkout(actor, order.id);
location.assign(checkout.url);
```

```ts
// The HTTP adapter supplies raw bytes and Stripe's signature header.
await payments.acceptWebhook(rawBody, stripeSignature);
// The service verifies signature, test mode, canonical session, and durable order binding.
```

```ts
// Cloudflare scheduled entry point; no public maintenance route.
await notifications.deliverBatch();
```

The functions expose the complete business capability. Callers never sequence multiple database mutations or manipulate payment/outbox flags.

## Shape

Use a single Cloudflare Worker deployment with static assets, one Supabase project dedicated to staging, Stripe test Checkout, and a transactional email provider with documented idempotency support such as Resend. No Cloudflare Queue, Durable Object, separate webhook deployment, frontend framework, or custom auth is needed.

```ts
type ServiceId = 'ai-audit' | 'catalog-starter' | 'catalog-full' | 'catalog-hosted';
type Actor = { userId: string; email: string };
type OrderState = 'awaiting_payment' | 'paid' | 'refunded';
type CheckoutState = 'reserved' | 'open' | 'expired' | 'paid';
type Intake = AuditIntake | CatalogIntake;
type OrderView = {
  id: string; service: ServiceId; amountCents: number; currency: 'usd';
  state: OrderState; intakeCompletedAt: string; paidAt: string | null;
  deliveryDueAt: string | null;
};
interface Orders {
  submitIntake(actor: Actor, requestId: string, intake: Intake): Promise<OrderView>;
  get(actor: Actor, orderId: string): Promise<OrderView>;
}
interface Payments {
  checkout(actor: Actor, orderId: string): Promise<{ url: string }>;
  acceptWebhook(raw: string, signature: string): Promise<void>;
}
interface Notifications { deliverBatch(): Promise<{ sent: number; pending: number }> }
```

### Module map

- `src/catalog.ts`: approved four-service registry, prices, intake definitions, audit scope, delivery rule. It generates browser-safe configuration. Database seed and registry values must be generated from one source or compared by a failing invariant test.
- `src/orders.ts`: input validation, user-owned order operations, and storage policy. No transport types escape this module.
- `src/payments.ts`: Stripe signature verification, test-mode enforcement, Checkout creation, durable retry identity, amount and order binding. This is the only Stripe caller.
- `src/notifications.ts`: fixed transactional templates, allowlisted staging recipients, leased outbox delivery. This is the only custom email caller.
- `src/access.ts`: verification with official `jose` JWT/JWKS primitives for Cloudflare Access; Supabase's official `getUser()` for client tokens. These validate provider tokens; neither implements authentication.
- `src/worker.ts`: small route adapter, static asset gateway, Origin enforcement, request size limits and scheduled trigger.
- `src/client.ts`: Supabase official SDK, one intake flow, contact form and order confirmation; HTML pages remain static.
- `supabase/migrations/*.sql`: schema, RLS, ownership checks, transaction functions, fixed catalog seed, private input bucket.

### Minimal HTTP contract

All routes except `POST /api/stripe/webhook` require a valid Cloudflare Access JWT. The Worker runs before every static asset. Missing/invalid Access issuer or audience fails closed; a development bypass, if necessary, binds only loopback with a separate development configuration and is forbidden by staging validation.

| Route | Client identity | Operation |
| --- | --- | --- |
| GET `/api/config` | Access | Browser-safe Supabase URL/publishable key, four services, test banner |
| POST `/api/leads` | Access | Validated contact lead, spam controls, owner alert; no client campaign subscription |
| POST `/api/orders` | Access + Supabase | Complete immutable intake plus order, idempotent request UUID |
| POST `/api/orders/:id/checkout` | Access + Supabase | Return existing unexpired Checkout or reserve/create its next attempt |
| GET `/api/orders/:id` | Access + Supabase | Small owner-scoped confirmation view |
| POST `/api/orders/:id/input` | Access + Supabase | Optional private CSV upload; never public bucket access |
| POST `/api/stripe/webhook` | Stripe signature | Verify raw-body signature and test mode, reconcile canonical session |

Mutations require exact configured Origin plus JSON/content-type limits, except Stripe webhook. Use bearer authorization for Supabase and never identity fields supplied in JSON. Access protects the preview, while Supabase identity owns customer data. They solve separate boundaries.

### Data and dominant access patterns

- `service_catalog(id primary key, name, amount_cents, currency, enabled)`: exactly the four approved IDs; no free or quote SKU. Worker retrieves or validates a deployment manifest against it.
- `orders(id uuid primary key, user_id references auth.users, request_id uuid, service_id references service_catalog, amount_cents, currency, intake jsonb, intake_completed_at, state, paid_at, delivery_due_at, created_at)`, unique `(user_id, request_id)`, index `(user_id, created_at)`. Intake is complete before Checkout. Order snapshot price is immutable. An idempotency-key payload mismatch is a conflict rather than returning a different order.
- `checkout_attempts(id uuid primary key, order_id, generation integer, state, stripe_session_id unique, checkout_url, reserved_at, expires_at)`, unique `(order_id, generation)`, one active attempt per order. The attempt UUID is the Stripe idempotency key and metadata binding.
- `stripe_events(id text primary key, event_type, received_at, processed_at)`. Store only fields needed to diagnose processing, not full payment payloads or card data.
- `notification_outbox(id uuid primary key, dedupe_key text unique, kind, recipient, payload jsonb, state, attempts, next_attempt_at, claimed_until, provider_id, created_at, sent_at)`. Index `(state, next_attempt_at)`.
- `leads(id uuid primary key, request_id uuid unique, name, email, service_interest nullable, message, created_at)`. Contact interest is not an enabled checkout service.
- `order_inputs(id uuid primary key, order_id, user_id, object_path unique, original_name, byte_count, created_at)`. Supabase bucket `order-inputs` is private. Prefer CSV-only and small bounded files for v1; no secrets, archives, executables, public URLs, or content rendering.

RLS allows authenticated clients SELECT of their own orders and input metadata only. No client writes to orders, attempts, outbox, event records or service prices. Other tables are invisible to clients. Storage policies constrain object prefixes to `auth.uid()/order_id/` and verified owned orders. A Worker service role can bypass RLS, so every API query independently scopes by verified user ID. Prefer user-token Supabase reads where possible, preserving RLS as defense in depth. Explicitly revoke public/anon/authenticated execution on privileged SQL RPCs, set a fixed `search_path`, and grant only `service_role`.

### Transaction functions and race behavior

1. `submit_intake(p_user_id, p_request_id, p_service_id, p_intake)` reads the authoritative catalog, inserts one order and a lead alert outbox record in one transaction. On duplicate request it returns the same order only if semantic intake and service match. It never trusts browser prices.
2. `reserve_checkout(p_user_id, p_order_id)` locks the owned order, rejects paid/refunded state, and returns its active durable attempt or inserts the next generation. Do not hold the DB transaction open during Stripe HTTP.
3. Stripe Checkout creation uses `checkout:<attempt-uuid>` as idempotency key and metadata with order and attempt IDs. Validate `sk_test_`/`rk_test_` prefix before any Stripe request; reject live response objects and price amounts/currency mismatches. Price IDs are staging configuration. No dynamic caller-selected price. Disable adjustable quantities, discount codes, or transformations that change the fixed total.
4. `attach_checkout(p_attempt_id, session_id, url, expires_at)` is compare-and-set. A webhook arriving before attachment can establish the same binding, because metadata refers to the already durable attempt. A different session on that attempt is a conflict.
5. `record_payment(p_event_id, p_attempt_id, p_session_id, amount, currency, paid_at)` inserts the event and locks its order in one transaction, verifies the immutable snapshot, binds the session, marks payment once, computes audit due date, and inserts client/owner outbox records by unique dedupe keys. An exception rolls back event insertion too, so webhook retries work. Duplicate and out-of-order events cannot regress a paid state. Only confirmed `payment_status=paid` sessions fulfil; asynchronous success is supported, failure/expiry cannot overwrite paid. Retrieve the canonical session and line items when necessary rather than trusting a browser event.
6. `claim_notifications(batch_size, lease_seconds)` uses `FOR UPDATE SKIP LOCKED` and time-limited claims. `complete_notification(id, claim_token, provider_id)` and `retry_notification(id, claim_token, error_code)` ensure stale workers cannot acknowledge new leases. Provider idempotency uses outbox UUID. Bound retries to the provider's documented dedupe window; after an ambiguous result crosses that window, leave a manual-review record rather than silently sending duplicates. Delivery is at-least-once with a documented residual uncertainty, never falsely described as exactly-once.

A failed Checkout HTTP response is retried with the same attempt UUID. Do not reuse an idempotency key beyond Stripe's retention period: reconcile/expire the known session before a new attempt, and park ambiguous old attempts for operator review. A scheduled reconciliation can inspect stranded attempts; a Phase 1 operator script is enough if no automatic reconciliation is built. Never expose an unauthenticated maintenance endpoint.

### Delivery and communications

For AI only, payment occurs after intake, so delivery starts at verified `paid_at`. Use an explicit America/New_York calendar helper, add five Monday-Friday dates excluding the start date, and render the deadline in Eastern. Holiday treatment and cutoff time are not approved: label the initial rule as weekdays with no holiday exceptions and obtain confirmation before production. Do not invent a delivery SLA for Catalog packages.

Supabase owns email-link messages and Google OAuth; custom SMTP and redirect allowlists are provider configuration. Disable public signups in the staging Supabase project and precreate only approved testers. Email-link calls use `shouldCreateUser: false`; otherwise the public Supabase endpoint could trigger email outside the staging allowlist despite Cloudflare Access. Validate Google login for precreated testers on the actual provider before declaring it ready. All application mail comes from fixed transactional templates: intake/order alert to the verified owner address, paid confirmation and later manual status update if implemented. No arbitrary recipient/template endpoint, marketing opt-in, campaigns, or Telegram. Staging has an explicit recipient allowlist and visible TEST labels. Stripe receipts remain configured in test mode; do not change live receipt settings.

## Synthesis decision

Pending parent comparison. This candidate concentrates durable consistency in Supabase transaction functions and keeps Cloudflare stateless. It hides payment and outbox coordination behind three domain services and six transactional operations.

## Tradeoffs accepted

- Accept SQL business transitions in exchange for atomic payment, order, and alert commits without another coordinator.
- Accept a small managed-auth surface in Phase 1 to bind intake and payments securely; defer account settings, dashboards, delivery libraries and admin UI.
- Accept a private small-file input bucket only if required by Catalog intake; avoid generic upload machinery and delivered-file portal scope.
- Accept documented operator review for rare old ambiguous payment/email attempts instead of building a full orchestration platform.
- Accept provider configuration as a deployment gate. Code and mocks cannot demonstrate Access, OAuth callbacks, SMTP, or real signed webhooks.

## Alternatives considered

- A Cloudflare Durable Object per order could serialize Checkout state and put retries near HTTP code. It still needs a durable payment ledger and Supabase RLS. Two authoritative stores would expose synchronization and recovery decisions to callers, so the extra moving part loses at this scale.
- A Supabase Edge Function backend hides auth and SQL proximity well but spreads deployment/secrets between a static Cloudflare host and Supabase functions. A single Worker better matches the chosen code-capable hosting and keeps test-only payment enforcement in one deployment.
- A fully client-side Supabase/Stripe flow is smaller superficially but exposes checkout policy, event processing and administrative state to clients. It cannot hide the security-critical server behavior.

## Open questions and risks

- Which Cloudflare account, Supabase staging project and Stripe test account are approved, and which identity should Access permit?
- What verified owner inbox, sender domain, and transactional email provider are available without new DNS changes?
- Are Monday-Friday delivery dates without a holiday calendar the intended production rule?
- What exact Catalog intake fields and file size limits are sufficient, and should Hosted Build remain visibly TEST ONLY pending its terms?
- Who resolves an outbox or payment attempt parked for manual review, and where should that operational alert appear if email itself is failing?

## Next implementation step

Build the schema/RPC invariants against real Postgres in the available cloud Docker runtime and test paid-event replay, two concurrent checkout requests, and cross-client access before wiring the existing page buttons to the new intake flow. Then run headless browser checks in the permitted cloud runtime, followed by provider-backed verification when credentials arrive.
