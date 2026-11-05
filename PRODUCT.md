# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Mobile-first web. A Capacitor iOS WebView wrapper exists in the repo; it does not make the design language native.)

## Users

- **Couples in Spain** getting married in the next 6–18 months (the customer). They create an account with email (magic link) to save, publish and manage their wedding. Mostly on mobile, also on desktop. Job: make their wedding invitation, send it to their people and know who is coming without chasing anyone.
- **Wedding guests** (second audience). They never create an account. Over 80 % arrive from a WhatsApp chat link on mobile, often inside WhatsApp's in-app browser. Job: open the invitation, get the details and answer "¿Nos acompañas?" through their personal link.
- Wedding planners are a later audience, not a primary one today.

## Product Purpose

Vinklo lets a couple create a wedding invitation with its own web page, guided step by step (the "Lovable" feeling: describe what you want, answer short questions, watch the invitation take shape), share it by WhatsApp with each guest, and organise the answers in one place. Creating the web is free.

Success now: the first **10 founder couples** with their wedding published and shared. The metric is weddings created and published, not waitlist emails.

## Positioning

**The invitation opens like a Story; the couple sees who is coming in a list that works like WhatsApp.** Full-screen HTML scenes the guest advances by tapping (not a video, not a long scroll), and a guest list where each person carries an honest state (invitation prepared, sending confirmed by the couple, answered). Free to create.

Gifts paid through the Vinklo link, and later paying vendors with those gifts, are the long-term reason Vinklo exists. They are not active and must not be promised on any surface.

## Operating Context

- Spanish weddings: ~115–120 guests on average; invitations and reminders travel by WhatsApp; the "sobre" (money gift) is the cultural norm.
- Couples work on the phone in short sessions over months: create, share, check answers, send reminders.
- WhatsApp sending is manual: Vinklo prepares the recipient and text; it never knows if a message was delivered or read.
- Each wedding is one public URL (`vinklo.es/b/<names>-<date>`) plus a personal link per guest.

## Capabilities and Constraints

- Live today (production): landing with waitlist, guided creator (`/crear`, 7 steps, 3 styles), email magic-link login, couple panel with guest list, RSVP by personal token, day agenda.
- Built locally (not yet deployed): versioned site document, shared renderer (editor preview = public page), draft/publish with optimistic locking, retire = 404.
- Planned: Story scene player (phase 2), photo upload, hotel/transport, companions by name, shared account for both partners (two emails, `wedding_members`), message templates and WhatsApp share per contact, blog aimed at couples organising guests.
- Pricing: free up to 100 invitations; paid above 100 (price not set, never shown). **The 10 founder couples keep no invitation limit, forever.**
- Payments: Stripe Connect code exists but stays disabled (`RSVP_MVP`). No surface may mention gifts, fees or payouts as available.
- Stack: Next.js 15 App Router + Supabase (Postgres, Auth, RLS) on Vercel; Spanish (Spain) only for now.

## Brand Commitments

- Name and wordmark: `vınklo` (dotless ı in clay). Never "VINKLO".
- Voice: Spanish from Spain, warm and precise. "Vosotros" to the couple, "tú" to the guest. Current headline (landing hero, 11-oct-2026) «Vuestra web de boda. Todos los detalles, bajo control.» (subhead «Cread vuestra invitación, compartidla por WhatsApp y organizad respuestas, acompañantes y mesas desde vuestro panel.»), CTAs «Crear nuestra web» and «Ver una boda de ejemplo» (→ /demo). Source: `docs/COPY-Y-VOZ-VINKLO.md`.
- Banned in copy: "perfecto", "mágico", "revolucionario", "sin esfuerzo", invented time claims, invented scarcity, testimonials, couple counts, tax/fiscal language, "recaudar", promises of WhatsApp delivery/reading.
- Visual identity v8 «Papel cálido» is recorded in `DESIGN.md` (owned there, not here).

## Evidence on Hand

- One demo wedding (`/demo`; `/b/ana-y-luis` redirects there), no real couples yet. Waitlist: 0 (Oct 2026).
- Market figures with sources in `docs/2026-09-07-draft-rumbo-y-landing-novios.md` (INE 175,364 weddings in 2024; bodas.net sector report 2026).
- No testimonials, logos, press or real photography exist. Do not fabricate them; use real product renders instead of AI-generated couples.

## Product Principles

1. The guest never works: no account, no app, one tap to answer.
2. Honest states over impressive numbers: prepared, sent (confirmed by the couple) and answered are different things.
3. The invitation is the product demo: every surface should show the real thing working, not a picture of it.
4. Free to start, earned to pay: value first (invitation + guest list), money later and only when it is verified.
5. Attendance, gift note and verified payment are independent facts; never merge them.

## Accessibility & Inclusion

- WCAG AA contrast (palette already verified in DESIGN.md), 44 px minimum touch targets, keyboard and screen-reader access to every scene, `prefers-reduced-motion` respected, zoom allowed.
- Guests of all ages open the invitation on mid-range phones inside WhatsApp's browser: content must be visible without animation and readable without JavaScript.
