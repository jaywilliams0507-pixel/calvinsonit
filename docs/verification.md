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
