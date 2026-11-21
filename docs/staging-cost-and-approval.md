# Cost and production approval

## Cost estimate

The approved infrastructure target remains about $40/month. At low traffic, client count does not change the baseline. Two Supabase Micro projects in one Pro organization cost approximately $35/month combined: the $25 plan includes $10 of compute credit for one project, and the second project adds about $10. Cloudflare Workers Paid starts at $5/month. These are planning estimates checked November 15, 2026, before taxes and overages; no subscription was purchased here.

| Monthly paying clients, one order each | Infrastructure, production plus staging | Example: all $299 audit orders, including domestic-card fees | Range across listed packages, including domestic-card fees |
| --- | ---: | ---: | ---: |
| 0 | $40 | $40 | $40 |
| 10 | $40 | $129.70 | $97.80 to $475.10 |
| 50 | $40 | $488.50 | $329.00 to $2,215.50 |

Stripe's published standard US domestic-card rate is 2.9% plus $0.30 per successful payment. Per-order estimates rounded to cents: Starter $5.78, Audit $8.97, Full $17.41, Hosted $43.51. Test-mode payments do not incur real processing fees. Actual account pricing, international-card fees, disputes, refunds, taxes, and optional services are outside the estimate. The number of purchases, package mix, and card origin determine payment cost.

Resend is the proposed transactional mail transport. Its listed included allowance is 3,000 messages/month with a 100/day cap. A small steady flow can fit at $0 additional cost; bursts or a paid plan can add $20/month, moving the baseline to approximately $60. Confirm Jay's sender/provider preference before purchase. Supabase sign-in mail shares the configured SMTP provider's limits. No marketing product, mailing list, or campaign is part of this build.

Storage and download usage also matter. The intake limits are small and files remain private, but arbitrary file growth and repeated downloads are not assumed to be free. Keep spend caps and alerts enabled; review actual usage before increasing limits. The business sells only fixed-price paid services; provider billing allowances are separate from the service offers.

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Stripe pricing](https://stripe.com/pricing), [Resend pricing](https://resend.com/pricing).

## Decisions still needed for provider staging

- Cloudflare account, workers.dev hostname, Access team, and allowed tester identities.
- Separate Supabase staging project and two precreated test clients; Google OAuth application and exact staging callback.
- Stripe test account/sandbox, four verified test prices, and test webhook signing secret. Jay will confirm account/settings; no live values are accepted.
- Confirmed Jay alert address, verified sender, and explicit test-recipient allowlist. New sender-domain DNS changes require separate authorization.
- GitHub staging environment credential access. The current connection receives HTTP 403 from the repository secrets API.

## Production decisions retained as gates

- Final Hosted Feed Build terms, including included runs, hosting duration, recurring obligations, termination, and delivery timing.
- Catalog delivery promises and final intake limits. The preview uses up to one CSV/XLSX file for Starter and three for Full/Hosted, each at most 10 MiB.
- Whether the five-business-day AI deadline excludes federal holidays. Preview calculation uses Monday through Friday in Eastern, excluding the start date, with no holiday calendar.
- Approved Stripe live account/settings, payment methods and national sales-tax treatment. The staging implementation has no live payment path.
- Final privacy retention schedule and operational deletion process. Do not imply an automatic deletion job exists until it has been built and verified.
- The final reviewed release and protected provider test evidence, then explicit approval for production deployment, DNS cutover, and repository visibility change.

## What stays out of Phase 1

No bespoke authentication, subscription billing, quotes, coupons, free service tier, Google Business Profile or Automation checkout, marketing email, CRM, Telegram, general-purpose chatbot, automated AI audit execution, full client dashboard, admin portal, or delivered-file library. These additions either conflict with approved business rules or belong to Phase 2. Supabase-managed sign-in and the individual order receipt are included only to bind intake and payments safely.
