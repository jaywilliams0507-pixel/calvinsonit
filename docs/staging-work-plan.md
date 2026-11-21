# Current continuation — November 21, 2026

Jay chose build, not buy; the November 5 vendor research is superseded. Continue the original implementation, with admin report delivery, private client downloads, ready email, two-way per-order messages and admin list/detail. Hosted is displayed at $1,490 and blocked from intake/checkout; GBP/Automation are email-only. The original baseline was verified at a685f11618bf97d1f6a6d37a4edd2dc6e0afa3aa (56 checks), then rebased locally onto live e40b5a94f2bb3f455b19fc0d5d0c2cd601dea3ac. Both legal files use exact live bytes. The existing remote staging branch is the sole destination; preserve shared history and never unconditionally force-push. Root maintains Agent Ops and reports to Jay.

Provider provisioning, external migrations, sandbox acceptance, paid plans, DNS and deployment remain out of scope pending verified isolated owner-provisioned staging resources. The original plan below records the November 15 implementation and does not override these current restrictions.

# Phase 1 staging work plan

Work runs in the cloud against `release/legal-buyer-fixes` at `9bd60ad`. No Mac dependency. The build branch is `codex/phase1-protected-staging`. No merge, DNS change, live Stripe change, repository visibility change, production deployment, or hosting cutover is authorized.

## Accepted scope

Protected Cloudflare staging preview. Supabase managed email-link and Google sign-in; no custom authentication. Fixed-price services: AI Visibility Audit $299, Catalog Starter $189, Catalog Full $590, Catalog Hosted $1,490. GBP and Automation remain informational and unavailable for purchase. No quotes or free offers.

The audit covers 20 questions on EACH of ChatGPT, Google AI Overviews, Gemini, Perplexity, and Copilot: 100 checks. Delivery is five business days in America/New_York after payment and complete intake. Hosted Build terms remain a production approval gate.

Phase 1 includes service intake, Stripe test Checkout and signed payment confirmation tied to an order, transactional client updates and Jay alerts. Supabase handles authentication. Stripe receipts stay enabled; no live Stripe keys, prices, or charges. No marketing email, lists, campaigns, or Telegram. Artifacts go to the repository; keys go to GitHub environment secrets and scoped provider runtime secrets. Expected production plus separate staging budget is about $40/month plus usage and Stripe fees.

## Falsifiable completion criteria

- Each sellable service has a validated intake and exactly its server-controlled test price.
- Payment state changes only through a verified test-mode Stripe webhook, with retry and duplicate protection.
- Two clients cannot read or mutate one another's data or private files.
- Supabase email links and Google use the provider's SDK and configured redirects.
- All preview HTML, assets, and application routes require Cloudflare Access; only the signed webhook is externally reachable.
- Transactional email uses a durable retryable outbox and a staging recipient allowlist.
- Tests pass, a protected cloud preview is verified, and provider evidence is recorded. Missing provider access is NOT verification.
- A review PR against the pending release contains the diff, configuration steps, cost, and rollback for later production approval.

## Todo

- [x] Frame: inspect pending release, authorization, cloud tools, and pstack.
- [x] Fan out: two independent architecture sketches.
- [x] Cross-judge: unavailable vendor families; parent scores designs and records limitation.
- [x] Pick: choose architecture by safety, retry consistency, provider simplicity, and maintainability.
- [x] Graft: integrate the best bounded alternative decisions.
- [x] Implement: staged feature slices and decision log.
- [x] Verify local code: typecheck, 26 unit/security tests, 14 PostgreSQL checks, 16 mocked-provider browser checks, Worker bundle dry run, and independent reviews.
- [ ] Verify providers: protected Cloudflare preview, hosted Supabase auth/storage, Stripe test checkout/webhook, and email delivery await provider access.
- [x] Report: diff, actual provider changes, costs, rollback, and remaining approval gates are recorded for the review PR.

## Throughput checkpoint

- Blocking first steps: fixed domain/API contract and architecture selection precede implementation.
- Independent workstreams: architecture candidates own separate files; implementation has one owner; deployment documentation can proceed independently.
- Shared mutable state: one writer per code scope; no concurrent git index changes or provider mutations.
- Smallest safe decomposition: one feature owner for the coupled API, schema, and browser contracts; independent reviewer after implementation.

## Tooling

pstack source: https://github.com/cursor/plugins/tree/bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7/pstack. Its requested Claude/Gemini families are not available in this environment. Architecture candidates use available Codex agents. No cross-vendor review is claimed.
