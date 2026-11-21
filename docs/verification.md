# Current verification — November 21, 2026

The original branch at `a685f11618bf97d1f6a6d37a4edd2dc6e0afa3aa` passed its complete 56-check baseline before edits: 26 unit/security, 14 PostgreSQL and 16 desktop/mobile browser cases. Dependency install required a task-owned `/tmp` npm cache in this restricted cloud environment; the lockfile was not changed.

The same implementation was rebased locally onto live `e40b5a94f2bb3f455b19fc0d5d0c2cd601dea3ac`. Both legal conflicts were resolved by taking exact live bytes. To avoid rewriting the shared remote branch/PR, the original staging head is retained as an additional merge parent after the local rebase; publication can be an ordinary fast-forward on the sole authorized branch. No new remote branch or PR is needed. No deployment marker appears in the review head commit message.

| Current local check | Result |
| --- | --- |
| `npm run check` | Both TypeScript projects, 40 unit/security/provider-protocol tests and static browser build pass. No lint script is configured. |
| `npm run test:db` | 22 checks pass on disposable PostgreSQL 17 containers with Supabase auth/storage schema fixtures; both migrations applied only there. |
| `npm run test:browser` | 24 desktop/mobile cases pass in cloud Chromium against the built static artifact and mocked provider APIs. |
| `wrangler deploy --dry-run` | Worker bundle and allowlisted assets compile; no provider upload. XDG config/log paths use task-owned `/tmp` directories. |
| `git diff --check` | Pass. |
| Buyer restrictions | Hosted displayed at $1,490; disabled intake choice, Zod rejection, Worker legacy-checkout denial, SQL new-order/checkout denial. GBP/Automation retain email-only service CTAs; neither is a valid order service. |
| Legal files | Empty diff versus live commit; hashes below. Build copies these bytes unchanged. |
| Provider isolation/flows | Not verified; no external migration, sign-in, payment, email or deployment performed. |

Current total: **86 checks**, preserving all original test cases with updated Hosted assertions for the new buyer restriction. New coverage includes Access/session/admin denials, cross-client workspace/Storage isolation, SQL grants and RPC denial, concurrent message dedupe, sender limits, report upload/reload recovery, atomic ready outbox, admin revocation, protected downloads, safe message rendering, Stripe test dashboard links, allowlist suppression and Resend retry keys.

SHA-256, identical to live source and built copies:

- `terms.html`: `8e99289059cf7e2f0885e3aabcd87837b1976b36b945daebb08d306ae373e1ee`
- `privacy.html`: `d052dfc9ac9459d57857c5b38f8c0ade15fab910198ef2f853df5e48cf8819c0`

Read-only GitHub Pages inspection confirms legacy hosting from `main` at `/` with `calvinsonit.org`. The only branch workflow runs checks on ordinary staging pushes and gates provider deployment behind an explicit head-commit marker. No workflow, live branch, Pages setting or deployment trigger was changed by this continuation.

Current UI captures contain only fabricated test identities, files and message content: [admin desktop](evidence/fulfilment-admin-desktop.png), [admin mobile](evidence/fulfilment-admin-mobile.png), [client desktop](evidence/fulfilment-client-desktop.png), [client mobile](evidence/fulfilment-client-mobile.png). The literal HTML-like strings demonstrate text-only rendering. These captures prove local UI behavior, not deployed Access or hosted providers. Current code received self-review; no independent or cross-vendor review of this extension is claimed.

Remaining gates: owner-provisioned and verified isolated Cloudflare/Supabase/Stripe-test/Resend resources; privileged staging migration and tester/admin provisioning; managed sign-in and sandbox payment/webhook/email/Storage acceptance evidence. Exact required/optional configuration and acceptance checks are in [staging operations](staging-operations.md). Paid plans, account signup, customer messages, DNS, live Stripe, production writes/deployments and merging remain unauthorized. Root maintains Agent Ops and reports to Jay.

The record below is historical November 15 evidence, including tooling limitations from that task. Its original four-purchasable-service and base-commit statements are superseded by the current continuation above.

---

# Verification record

## Scope

Cloud workspace `/workspace/calvinsonit-phase1`, branch `codex/phase1-protected-staging`, based on pending release `9bd60ad37b00aa9324ca8db1c50ff38aed6f7278`. Tests use synthetic clients and files. No Mac, live payment, production deployment, or outbound customer email is required for local verification.

## Status

| Surface | Status | Evidence |
| --- | --- | --- |
| Pending release baseline | Verified | Isolated cloud clone and branch from `release/legal-buyer-fixes`. |
| pstack design exploration | Verified | Two independently authored sketches and parent synthesis in `docs/architecture/`; no cross-vendor judge available. |
| Type checking and build | Verified locally | `npm run check`: both TypeScript configurations, 26 Vitest tests, and allowlisted asset build pass. |
| Payment, intake and deadline logic | Verified locally | Input/price tampering, real test webhook signatures with mocked HTTP, retry identity, price rotation, and stable Eastern deadline cases pass. |
| PostgreSQL transactions and RLS | Verified locally | `npm run test:db`: 14 PostgreSQL 17 checks pass with Supabase schema fixtures, including role isolation, storage write denial, concurrent checkout, refunds, and stale leases. |
| Browser forms and responsive layout | Verified with mocked providers | `npm run test:browser`: 16 desktop/mobile cases pass. Two copy cases also reran after a reduced-motion screenshot adjustment. |
| Independent code review | Reviewed; findings resolved | Independent Codex security review found two issues, both fixed and retested. Comment/deslop review found no actionable issues. See linked reports below. |
| Runtime dependencies | Audited locally | `npm audit --omit=dev --audit-level=high`: zero known vulnerabilities reported. |
| Worker bundle | Verified locally | Wrangler `deploy --dry-run`: 36 static assets, 1,761.75 KiB Worker / 316.11 KiB gzip. No provider mutation. |
| Protected Cloudflare preview | Not verified | Cloud account credentials and Access configuration unavailable. |
| Supabase hosted auth/storage | Not verified | No staging project credentials or OAuth/SMTP settings available. |
| Stripe test Checkout/webhook | Not verified with provider | No confirmed Stripe test account or credentials. Local signature and protocol tests are separate evidence. |
| Transactional email delivery | Not verified with provider | Confirmed sender, Jay recipient, test allowlist and provider credentials are pending. |

## Provider changes made

None. This task has not changed DNS, Cloudflare, Supabase, Stripe, email-provider settings, GitHub Pages hosting, repository visibility, or the pending release branch. Update this record only after an actual authorized change and verified result.

## Review limitation

The available independent agents are Codex agents. pstack's named Claude/Gemini runners and a cross-vendor judge are unavailable, so those review claims are not made. Provider configuration remains a distinct acceptance gate even if all local tests pass.

## Evidence and resolved findings

- [Independent security and correctness review](reviews/security.md): duplicate upload recovery and price-rotation payment reconciliation resolved, with focused rechecks.
- [pstack comment/deslop review](reviews/comments.md): final deployment code included; no actionable findings.
- Parent review also fixed deadline drift on a second paid event and pending-upload recovery after page reload.
- [Desktop package capture](evidence/catalog-desktop.png) and [mobile package capture](evidence/catalog-mobile.png) show the built static artifact in cloud Chromium with reduced motion. The screenshot's staging label describes the intended environment; these are local UI evidence, not proof of deployed Access protection.
- The parent read the intake desktop and catalog mobile captures, verified the logo and form layout, and checked the completed copy against the fixed service scope.

All provider-backed acceptance checks remain open. The cloud environment has no configured secrets or outbound identities; repository secret-setting access returned HTTP 403. A cloud-browser navigation attempt failed with `Browser Use could not read requirements` before Cloudflare loaded. This is a tooling/access blocker, not an observed Cloudflare outage. No Mac session was used.
