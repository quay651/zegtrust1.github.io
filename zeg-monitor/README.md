# ZEG Site Monitor

Runs once a day (or on demand) and emails a plain-language report covering:

1. **Payment & enrollment flow** — a real Stripe test-mode Checkout Session
   run through the actual webhook → Supabase enrollment → welcome-email
   pipeline, then fully cleaned up (enrollment row + auth user deleted).
2. **Page content integrity** — flags unexpected changes to zegtrust.org
   (possible unauthorized edits/defacement).
3. **Page speed** — Core Web Vitals via Google's free PageSpeed Insights API.
4. **Uptime** *(optional)* — pulled from UptimeRobot if set up separately.

No servers to maintain — runs on GitHub's free Actions minutes.

## One-time setup

### GitHub Secrets (Settings > Secrets and variables > Actions > Secrets)
| Secret | Where to get it |
|---|---|
| `STRIPE_TEST_SECRET_KEY` | Stripe dashboard → Developers → API keys → **test mode** secret key |
| `SUPABASE_URL` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings (service role, not anon key) |
| `RESEND_API_KEY` | Resend dashboard |
| `PAGESPEED_API_KEY` | Optional |
| `UPTIMEROBOT_API_KEY` | Optional |

### GitHub Variables (same page, Variables tab)
| Variable | Example value |
|---|---|
| `RESEND_FROM_EMAIL` | `access@zegtrust.org` |
| `REPORT_RECIPIENTS` | your email(s), comma-separated |
| `SITE_BASE_URL` | `https://zegtrust.org` |
| `MONITORED_PAGES` | `/` (single-page site — see note below) |

Note: `zegtrust.org` is a single-page site with anchor links
(`#privacy-policy`, `#course`, etc.) — those aren't separate URLs, so
`MONITORED_PAGES` only needs `/`. The checkout/enrollment flow itself is
covered by the transaction check above, not a page fetch.

The transaction check hardcodes the real schema: `enrollments` table,
matched on `stripe_session_id`, with cleanup that also deletes the
Supabase Auth user the webhook creates. No `SUPABASE_STUDENTS_TABLE` or
`SUPABASE_LOOKUP_COLUMN` variables are needed.

### Test it manually before trusting the schedule
Actions tab → "ZEG Site Monitor" → **Run workflow**. Check the email
arrives and everything shows OK before letting the daily schedule run
unattended.

## Ongoing maintenance
- If pricing changes, update `unit_amount: 14900` in `transactionCheck.js`.
- A "content integrity" flag on a page you intentionally edited is expected
  — no action needed, next run's hash becomes the new baseline.
- A failed run shows red in the Actions tab even if the email itself fails
  to send, so that tab is the fallback source of truth.
