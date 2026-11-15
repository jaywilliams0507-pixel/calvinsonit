# Staging architecture decision

Choose one Cloudflare Worker for protected assets and backend commands, with Supabase managed authentication, private storage, and transactional Postgres operations. Candidate A is the base because one runtime avoids a gateway credential and a second deployment pipeline. Supabase Edge Functions remain a viable later alternative, not an additional layer now.

| Criterion (5 best) | A: one Worker | B: gateway plus Edge Functions |
| --- | --- | --- |
| Protected preview and test-only payment boundary | 5 | 4 |
| Crash, duplicate, and concurrency consistency | 5 | 5 |
| Provider setup and operational simplicity | 5 | 2 |
| Fit with static release and thin Phase 1 | 5 | 3 |
| Maintainability and single state owner | 4 | 3 |

Read both sketches in full before selection. The cross-vendor judge was skipped because only Codex agents are available. This is parent-scored synthesis with independent same-model candidates, not cross-vendor validation.

Graft from B: explicit staging-user membership in data policies as well as disabled public signup; completed intake is immutable. Both candidates agree on a durable Checkout attempt before contacting Stripe, atomic order/payment/outbox commits, leased mail delivery, and an operator-review state when a provider's idempotency window expires.

Refinement: Catalog requires a draft order before private file upload, followed by complete-intake validation before payment. AI intake can complete immediately when its required fields validate. The delivery clock starts only when both complete intake and verified payment exist. Use five Monday-Friday days in Eastern and clearly retain holiday policy as a production question.

The public API is a service registry, service intake, a contact form, and an owned order receipt page. Phase 2 account settings, order dashboard, deliverables library and admin UI are deferred. No queue, Durable Object, generic workflow framework, custom authentication, arbitrary email API, live payment path, or production deploy target is needed.

Verification must exercise real Postgres transactions and roles, browser forms on the cloud machine, and then the actual configured providers. Missing provider credentials leave the final stage unverified.
