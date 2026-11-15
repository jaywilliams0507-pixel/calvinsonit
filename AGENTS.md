# CalvinsonIT project instructions

## Execution and storage

Run builds in the cloud against this GitHub repository. Use Claude Code on the web or Codex cloud tasks when using those products. A locked or powered-off Mac must not stop a build. Use Jay's Mac only for a task that truly requires its signed-in browser or a Mac-only file; name the exact dependency in the work log before using it.

Keep credentials in GitHub environment secrets and the scoped provider runtime secret stores that need them. Never commit credentials or put them in logs, screenshots, public configuration, or chat. Save deliverables to the repository or Drive.

## Current staging boundary

Phase 1 is based on `release/legal-buyer-fixes`. Keep the pending release and live site unchanged until Jay explicitly approves production. Do not merge, change DNS, change repository visibility, switch hosting, or use live Stripe keys/prices/charges as part of staging work. Plan the repository-private change for the Cloudflare cutover, but do not perform it now.

The staging preview must be protected before any application or static asset can be served. Use a separate Supabase staging project, admitted test users, and Stripe test mode. Preserve failing access checks rather than adding a deployed bypass. Record actual provider changes and verification separately from local tests.

## Business rules

Legal name: CalvinsonIT. Services are sold nationally at listed fixed prices. No quotes or free service tiers. Sellable packages are AI Visibility Audit $299, Catalog Starter $189, Full Catalog Cleanup $590, and Hosted Feed Build $1,490. Google Business Profile and Automation are informational only until their fixed offers are approved. Hosted Build terms remain a production gate.

The AI audit tests 20 questions on EACH of ChatGPT, Google AI Overviews, Gemini, Perplexity, and Copilot, for 100 checks total. Delivery is five business days in Eastern after both verified payment and complete intake. Confirm holiday treatment before production.

Use Supabase-managed email links and Google sign-in. Write no custom authentication. Transactional receipts, sign-in links, order updates, and lead/order alerts to Jay are allowed. Keep Stripe receipts on. No marketing messages, lists, campaigns, or Telegram. Staging custom email must use an explicit recipient allowlist.

## Review evidence

Use pstack's architecture, verification, and decision-log practices when available; record actual reviewers and tooling limitations. Never claim a provider flow was verified by mocks. Keep the production approval packet focused on the diff, provider changes, cost, rollback, and open decisions.
