# Vinklo

**Your wedding website. Every guest, up to date.**

Vinklo is a web app for couples getting married in Spain. A couple builds
their wedding website and invitation scene by scene, answering a few
questions with a live preview. Each guest gets a personal link (usually
shared over WhatsApp) to open the invitation and RSVP without creating an
account. A mobile-first guest CRM then shows who is coming, who hasn't
answered, who can't make it and who is bringing a plus-one.

Live at **[vinklo.es](https://vinklo.es)** (Spanish) · landing in English at
[vinklo.es/en](https://vinklo.es/en).

> This is a public snapshot of the source code, shared so it can be reviewed.
> Day-to-day development happens in a private repository. See
> [License](#license).

## What's inside

- **Scene-based website builder** (`app/crear`, `components/creator`): couples
  create their site step by step; the editor and the public site share one
  renderer, so the preview is exactly what guests see.
- **Two layouts over the same scenes**: a long scrolling "web" layout with
  scroll-linked motion, and a "story" layout (one scene per screen, auto-advance
  with pause, keyboard and reduced-motion support).
- **Public site and personal guest links** (`app/b/[slug]`, `app/v/[token]`):
  token-based RSVP links, answers validated on the server, no guest account
  needed.
- **Guest CRM** (`app/panel`): attendance, plus-ones, reminders, and guest
  lists imported straight from a couple's Excel file.
- **AI assistant** in the builder and the panel (Vercel AI SDK + Claude) that
  proposes changes the couple can review before applying.
- **iOS wrapper** with Capacitor (`ios`, `native`).

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
Supabase (Auth + Postgres with row-level security) · Vercel ·
Vercel AI SDK · Resend · Sentry · Vitest · Playwright.

## Engineering notes

- **Data access is enforced in Postgres.** Every table has row-level security;
  writes check ownership of the `wedding_id`, and a public slug only locates a
  site, it never authorizes. 66 additive migrations live in
  `supabase/migrations`.
- **Tested at several layers**: 170+ unit test files (Vitest), 45 SQL suites
  that run every migration on an empty Postgres and check permissions across
  two weddings (`tests/sql`), and a browser smoke test (Playwright, `e2e`).
- **Production only ships from green CI.** `.github/workflows/ci.yml` runs
  lint, type-check, unit tests, a production build, the SQL suites and the
  browser smoke test; the production deploy job runs only when all of them
  pass.
- **Privacy by default**: no caching of guest data or tokens on public pages,
  personal data scrubbed before it reaches Sentry
  (`lib/observability/sentry-scrub.ts`), CAPTCHA on sign-in.
- **Accessible, mobile-first UI**: most guests open the invitation inside
  WhatsApp's in-app browser on a phone. The design system is documented in
  [`DESIGN.md`](DESIGN.md) and the product brief in [`PRODUCT.md`](PRODUCT.md).

## Running it locally

Requires Node 24 and a Supabase project of your own.

```bash
npm ci
cp .env.local.example .env.local   # fill in your own Supabase keys
npm run dev                        # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint (fails on any warning) |
| `npx tsc --noEmit` | Type-check |
| `npm test` | Unit tests (Vitest) |
| `scripts/test-sql.sh` | Migrations + SQL suites on a temporary Postgres |
| `npx playwright test` | Browser smoke test |

Most of the product copy and code comments are in Spanish (Spain), the
language of the product.

## Team

Designed and built from scratch by Cristina Otero, with José Luis García
Benito.

## License

Copyright © 2026 Cristina Otero and José Luis García Benito. All rights
reserved. The code is published for review only; it may not be copied,
modified or redistributed without written permission. See [LICENSE](LICENSE).
