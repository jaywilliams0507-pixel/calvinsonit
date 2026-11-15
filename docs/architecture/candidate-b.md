# Candidate 2: Supabase command boundary behind a protected Cloudflare shell

## Grounding and todo

- [x] Ground: read pending-release pages, terms, privacy, site script, and approved staging scope.
- [x] Sketch: direct managed-auth/RLS client data plus Supabase command functions.
- [x] Agree: candidate supplied for parent synthesis; no human pause required by this sketch.
- [ ] Implement: deliberately not performed by this candidate.
- [ ] Scrap: reject if the extra runtime and protection checks exceed the benefit below.

The repository is static HTML with one presentation script. There is no account, order, upload, or webhook subsystem to preserve. Preserve the pending release's visual design, route aliases, legal links, and contact fixes. Replace the existing live Stripe link on the staging build. The present audit copy conflicts internally: 25 questions in the home sample, 20 across five engines in terms, and only two engines in explanatory sections. The catalog's two purchase links are email links and Full/Hosted have no purchase entry. Home and service pages contain quote language. These are integration requirements, not grounds for a redesign.

## Problem

The client needs a protected staging intake and payment path while the public site remains on GitHub Pages. Supabase already owns identity, database, and private object storage. This candidate asks whether Supabase should also own the backend commands, leaving Cloudflare responsible only for assets and the access boundary. This is structurally distinct from making a Worker the business backend.

## Usage, written before the types

A visitor enters the staging preview through Cloudflare Access, chooses a service, signs in using Supabase's email link or Google flow, completes intake, uploads the required files, and starts test Checkout. The return page reads the order; it never treats a success URL as proof of payment.

```ts
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/account/callback` },
});

const draft = await intake.create({ service: 'catalog-starter', answers, requestId });
await intake.upload(draft.id, supplierFile);
const checkout = await orders.checkout(draft.id, requestId);
location.assign(checkout.url);

const order = await intake.read(orderId);
renderOrder(order); // waiting for payment until verified webhook commits
```

`intake` and `orders` are browser adapters, not coordinators. They hide the transport, storage paths, and database columns. The browser can see the four fixed service choices but cannot set a charge amount, paid status, owner, due date, notification recipient, or object key.

## Shape

```ts
type ServiceId = 'ai-audit' | 'catalog-starter' | 'catalog-full' | 'catalog-hosted';
type OrderState = 'draft' | 'awaiting_payment' | 'ready' | 'refunded' | 'cancelled';
type PaymentState = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';
type OrderView = {
  id: string;
  service: ServiceId;
  state: OrderState;
  payment: PaymentState;
  intakeCompleteAt: string | null;
  paidAt: string | null;
  dueAt: string | null;
};

type Intake =
  | { service: 'ai-audit'; businessName: string; website: string; services: string[];
      markets: string[]; competitors: string[] }
  | { service: Exclude<ServiceId, 'ai-audit'>; businessName: string;
      storeUrl: string; productCount: number; distributorCount: number;
      instructions: string };

type OrderCommands = {
  create(input: { intake: Intake; requestId: string }): Promise<OrderView>;
  completeIntake(orderId: string): Promise<OrderView>;
  checkout(orderId: string, requestId: string): Promise<{ url: string }>;
};
```

Use one service registry to derive client choices, validation, server amounts, test price environment names, and copy checks. AI is 29,900 cents; catalog prices are 18,900, 59,000, and 149,000 cents in USD. Registry includes the audit's five engine names and 20 questions per engine. Billing code imports this registry; static copy must either render from it or have a content consistency check.

### Module map

- `src/client/auth.ts`: official Supabase SDK, PKCE email callback and Google OAuth; no password/token implementation.
- `src/client/intake.ts`: browser adapter, input form, order receipt/status, private upload adapter.
- `src/domain/services.ts`: authoritative service registry and input schemas.
- `src/worker.ts`: Cloudflare Access JWT validation with a maintained JOSE library, allowlisted static assets, same-origin command forwarding, security headers. No order SQL or Stripe calls.
- `supabase/functions/order-command/index.ts`: authenticates the forwarded bearer token with Supabase `getUser`, validates commands, uses the service registry, owns Stripe Checkout integration.
- `supabase/functions/stripe-webhook/index.ts`: checks raw-body Stripe signature and test mode, translates provider events, calls one atomic database transition.
- `supabase/functions/send-notifications/index.ts`: scheduled transactional outbox drain.
- `supabase/migrations/*`: RLS, storage restrictions, state-transition functions, idempotency constraints.

The command surface is limited to create, complete intake, checkout, and read. The caller does not coordinate reservation, session binding, fulfillment, or alert enqueueing. This provides a deep interface but exposes deployment across two code runtimes to operators.

### Network boundary

Use one Cloudflare Access application for the whole staging hostname, including assets and auth callback. All Worker application paths verify Access JWT audience and issuer as defense in depth. Missing Access configuration fails closed. No local-development bypass may be enabled on a deployed host.

Allow exactly `/api/stripe/webhook` through Access for Stripe and forward its unmodified body. The webhook function only accepts verified Stripe signatures. Its direct Supabase URL is therefore also safe to expose as a webhook, though keeping one documented endpoint reduces confusion.

A direct Supabase command-function URL would bypass Cloudflare Access. Protect it with a server-to-server gateway secret in addition to the user's Supabase token. This is service authorization, not custom user authentication. Configure the function not to confuse the gateway credential with the user bearer token. The Worker strips incoming internal headers before adding its own. Rotate and store this secret in GitHub staging secrets plus both runtimes. This extra credential is a significant disadvantage versus the single-Worker candidate.

Supabase managed auth endpoints must remain public for login. Disable open signup, precreate approved test users, and send email links with `shouldCreateUser: false`. Disable unapproved provider signup using supported Supabase settings/hooks. RLS also requires membership in a private `staging_testers` table, so a successfully created outsider account still cannot access business data. Never embed the service role key in the browser. Test clients are explicitly admitted accounts, not arbitrary emailed addresses.

### Data and state ownership

| Relation | Purpose and access |
| --- | --- |
| `orders` | Owner UUID, service ID, immutable amount/currency snapshot, intake JSON, state timestamps. Clients select only their own tester-owned row; writes are commands. |
| `order_files` | Order ID, unique object key, original filename, size/type, upload state. Client receives constrained upload intent; storage ownership enforced by RLS. |
| `checkout_attempts` | Order ID, generation, stable Stripe idempotency key, reserved/session ID state, expiry. One unresolved attempt per order. |
| `stripe_events` | Unique Stripe event ID, observed object ID, processed timestamp. No full payload retained unnecessarily. |
| `payments` | Unique session/payment-intent ID, order ID, paid/refund facts. An event never invents a second order. |
| `notification_outbox` | Unique event-kind/order/recipient key, template kind, attempt count, next try, lease token, lease deadline, provider message ID. No marketing templates. |
| `leads` | Contact submission with rate limits and an immutable alert event; no campaign subscription. |
| `staging_testers` | Explicit accepted auth user IDs; only privileged operators can change membership. |

Atomic functions perform `create_order`, `complete_intake`, `reserve_checkout`, `bind_checkout_session`, `apply_verified_payment`, `claim_notifications`, and `finish_notification`. They execute with a fixed search path, explicit role grants, and no client capability to invoke paid-state transitions. A single transaction updates payment/order state and inserts its outbox messages. `auth.uid()` or the verified caller identity supplied by the trusted backend determines ownership, never a request body's user ID. Service-role-only functions take verified actor IDs because service-role JWTs themselves do not identify a client.

Intake is immutable once complete/payment initiated. This avoids a customer replacing the required intake while a payment webhook races. A new correction can be recorded later through an operator workflow; no Phase 2 admin UI is required.

`ready_at = max(paid_at, intake_complete_at)`. The audit deadline is five business days after that moment in `America/New_York`. Use an explicit weekday calendar with a stated holiday policy, and test DST/weekend transitions. Do not silently assign an SLA to catalog packages whose delivery promise has not been approved.

### Retry and failure contract

- Order creation is unique on `(user_id, request_id)`; repeated requests return the same order, while a mismatched payload for the same key conflicts.
- Checkout reservation is atomic per order. Stable Stripe idempotency key belongs to the reserved attempt. Repeated requests retrieve the same active session. The webhook can match an attempt ID in verified metadata before the post-create bind returns.
- Never repeat a session-create call with an expired Stripe idempotency key if its first outcome was unknown. Persist uncertainty and require reconciliation. If a known session expires, record expiration before reserving the next generation. A paid order cannot reserve another attempt.
- Signed test events must match expected amount, USD currency, checkout mode, order/attempt identity, and the account's configured endpoint. Reject live keys at startup, live prices at Checkout, and `livemode:true` events. Payment confirmation requires a paid session, not merely `checkout.session.completed`.
- Deduplicate Stripe event IDs and session/payment IDs in the same transaction as state changes. Handle delayed completion, async success/failure, expiry, refund, and dispute without regressing a paid order to unpaid. Refund/dispute facts should block operational fulfillment even when they arrive before another event.
- Outbox leases expire so crashed senders recover. Stable provider idempotency keys prevent duplicate retries within the provider's supported window. After an uncertain delivery exceeds that window, mark it for operator reconciliation rather than claim exactly-once email. Successful Stripe receipts remain owned by Stripe, not duplicated by the application.
- Recipient allowlist and template enum enforce staging transactional email. Owner recipient must be explicitly configured by Jay. The application never broadcasts to all accounts.

## Synthesis decision

This is an alternative candidate, not the final selection. Prefer the single-Worker backend if both candidates satisfy the security/state guarantees, because Cloudflare is already required and the additional function runtime and gateway secret buy little for Phase 1. The worthwhile graft from this candidate is direct managed Supabase auth and private storage/RLS, not the second compute boundary.

## Tradeoffs accepted

- We accept two deploy pipelines and a gateway credential in exchange for keeping domain commands adjacent to Supabase.
- We accept an explicit tester allowlist in exchange for protecting direct Supabase data paths as well as the preview hostname.
- We accept transactional SQL for payment and outbox invariants in exchange for correct crash recovery; this is a real shared-state invariant.
- We accept one lightweight order receipt/status page in exchange for usable payment confirmation, without building the Phase 2 dashboard or admin portal.

## Alternatives considered

1. **Worker owns all commands, Supabase owns data/auth/storage.** This hides the same complexity with fewer operational boundaries and should win on maintainability for this small static site. Keep SQL atomic transitions regardless.
2. **Direct browser writes all order state with RLS.** Reject. RLS protects ownership but does not make prices, paid state, and checkout reservation trustworthy. Browser-created rows still need carefully restricted commands for invariants, erasing most simplification.
3. **Worker plus Durable Objects per order.** Reject. The isolated actor simplifies concurrent checkout reservation but adds a second authoritative state store and crash reconciliation with Postgres.

## Red-flag screen

No UI copies of prices or ad hoc paid booleans. No alternate webhook fulfillment writer. No generic repository abstraction. The main red flags are the Worker forwarding layer, two runtimes, and the extra access secret: each is defensible for this candidate but they are real costs that favor the single-Worker shape.

## Open questions and risks

Which Cloudflare account/Access tester emails, separate staging Supabase project, and Stripe test account should be configured? What verified transactional sender and Jay destination are approved? Does “business days” exclude US federal holidays? What are Hosted Build terms and catalog delivery promises? These block provider verification or production approval, not local contract tests.

## Next implementation step

Implement the fixed service registry and SQL state transitions with real Docker Postgres tests for two-user authorization and duplicate/racing webhooks before connecting the browser forms or provider credentials.
