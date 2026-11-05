// Primero el renderer (portadas): Turbopack ordena el chunk compartido del
// renderer según el primer import que lo alcanza; así sale idéntico al de
// /demo y /b y el navegador lo baja una sola vez (P1-4). No reordenar: lo
// vigila scripts/check-shared-renderer-chunk.mjs en CI, tras el build.
import { flightCovers } from "@/components/landing/flight-covers";
import { NacarBackground } from "@/components/brand/nacar-background";
import Link from "next/link";
import { DEMO_CONFIRMED, DEMO_GUESTS, DEMO_INVITED } from "@/components/landing/demo-guests";

import { LandingNav, LandingSwitchSection } from "@/components/landing/landing-c-chrome";
import { LandingFlight } from "@/components/landing/landing-flight";
import { TemplateCards } from "@/components/landing/landing-templates";
import { HeroParallax } from "@/components/landing/landing-hero-motion";
import { HeroMark } from "@/components/landing/landing-hero-mark";
import { LandingFinale } from "@/components/landing/landing-finale";
import { RevealWords } from "@/components/landing/reveal-words";
import { LandingMotion } from "@/components/landing/landing-motion";
import { GiftsNotify, KnowList } from "@/components/landing/landing-pieces";
import { FAQS } from "@/components/landing/faqs";
import { landingCopy, type Locale } from "@/components/landing/copy";
import { ArrowRightIcon, BellRingIcon, CalendarClockIcon, LayoutGridIcon, MailOpenIcon, MessageCircleIcon, UsersIcon, PencilIcon } from "lucide-react";
import { BRAND_CONTACT_EMAIL } from "@/lib/brand";

import "./landing-lovable.css";
import "./landing-atelier.css";
import "./landing-cordially.css";
import "./landing-envelope.css";
import "./landing-process.css";
import "./landing-flight.css";

/**
 * Landing (2026-10-06): formato de cordially.io a petición del propietario
 * («replica el formato de cordially.io para toda la landing»), con la marca
 * v8 de vinklo y su producto real.
 *
 * 7-oct-2026 (mensajes nuevos y página más ligera, sobre papel):
 *  1. Hero (11-oct, P2-1): «Vuestra web de boda. Todos los detalles, bajo
 *     control.», dos llamadas y el producto real (móvil «Origen» + panel).
 *  2. Vuestra web: las tres plantillas y la idea en una frase (/crear?idea=).
 *  3. Una cosa más: regalos (próximamente) con aviso por email.
 *  4. Preguntas y pie.
 *
 * Sin reseñas ni cifras de clientes (no las hay) y sin fotos de parejas
 * (PRODUCT.md): la imagen es la textura cálida de la landing.
 *
 * 1-nov-2026: la misma página en inglés en /en (`locale="en"`); los textos
 * viven en copy/es.ts y copy/en.ts. La raíz lleva `lang` (el <html> es «es»).
 */


/** FAQ visibles y su FAQPage JSON-LD (app/page.tsx): una sola fuente. */
export const LANDING_FAQS = FAQS;


/**
 * Antes de pintar: marca la raíz con data-motion para que los reveals que ya
 * están a la vista (al recargar a media página) empiecen ocultos y se animen
 * al hidratar, sin aparecer y desaparecer. Sin JS no corre (todo visible);
 * si LandingMotion no llega a montar en 4 s, se quita y todo queda visible.
 */
const LANDING_MOTION_BOOT = `(function(){var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var q=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;r.setAttribute("data-motion",q?"reduce":"full");setTimeout(function(){if(!r.hasAttribute("data-motion-ready"))r.removeAttribute("data-motion")},4000)})()`;

export function LandingLovable({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale);
  const { bento } = t;
  return (
    <div className="ll-home lc-home" lang={t.lang} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: LANDING_MOTION_BOOT }} />
      <NacarBackground />
      <a className="ll-skip" href="#contenido">
        {t.skip}
      </a>
      <LandingNav locale={locale} />

      <main id="contenido">
        {/* 1 · Hero (P2-1): titular, una frase, dos llamadas y el producto
            real (vuestra web en el móvil + vuestro panel). El h1 es el LCP:
            se pinta sin animación de entrada. */}
        <section className="lc-hero lc-hero--paper" aria-labelledby="ll-title">
          <HeroParallax
            className="lc-hero-wrap"
            bg={null}
            copy={<>
              <h1 id="ll-title" className="lc-display lc-hero-title">
                {t.hero.title.pre}<em>{t.hero.title.em}</em>
              </h1>
              <p className="lc-hero-lead ll-enter" style={{ "--enter-delay": "120ms" } as React.CSSProperties}>
                {t.hero.lead}
              </p>
              <div className="ll-enter" style={{ "--enter-delay": "180ms" } as React.CSSProperties}>
                <KnowList locale={locale} />
              </div>
              <div className="lc-hero-ctas ll-enter" style={{ "--enter-delay": "240ms" } as React.CSSProperties}>
                <Link href="/crear" className="ll-btn-clay ll-pressable lc-hero-cta">{t.nav.create} <ArrowRightIcon aria-hidden="true" width={18} height={18} /></Link>
                <Link href="/demo" className="lc-hero-demo ll-pressable">{t.hero.demo}</Link>
              </div>
              {t.hero.note && <p className="lc-hero-note ll-enter" style={{ "--enter-delay": "240ms" } as React.CSSProperties}>{t.hero.note}</p>}
            </>}
            mock={<HeroMark locale={locale} />}
          />
        </section>

        {/* 2 · El vuelo (01 sobre · 02 personalizad · 03 enviad y seguid):
            justo después del hero, para ver el producto antes de seguir. */}
        <LandingFlight covers={flightCovers()} locale={locale} />

        {/* 3 · «Hacedla vuestra» ------------------------------------------ */}
        <LandingSwitchSection locale={locale} />

        {/* 3 · Vuestra web ------------------------------------------------- */}
        <section id="estilos" className="lc-section lc-paper" aria-labelledby="ll-styles-title">
          <div className="lc-container lc-section-head">
            <p className="lc-kicker lc-kicker--clay">{t.styles.kicker}</p>
            <h2 id="ll-styles-title" className="lc-display lc-h2" data-reveal="words"><RevealWords>{t.styles.title.pre}<em>{t.styles.title.em}</em></RevealWords></h2>
            <p className="lc-sub">{t.styles.sub}</p>
          </div>
          <div className="lc-container"><TemplateCards locale={locale} /></div>
          <div className="lc-container lc-idea-block" data-reveal="fade">
            <form action="/crear" method="get" className="lc-idea lc-idea--paper">
              <label htmlFor="lc-idea" className="lc-idea-label">{t.styles.ideaLabel}</label>
              <span className="lc-idea-row">
                <input id="lc-idea" name="idea" maxLength={600} autoComplete="off" enterKeyHint="go" placeholder={t.styles.ideaPlaceholder} />
                <button type="submit" className="lc-pill lc-pill--ink">{t.styles.ideaSubmit} <ArrowRightIcon aria-hidden="true" width={18} height={18} strokeWidth={1.75} /></button>
              </span>
            </form>
          </div>
        </section>

        {/* 4 · Frase con imágenes ------------------------------------------ */}
        <section className="lc-chapter lc-statement" data-tone="dark" aria-label={t.statement.label}>
          <p className="lc-display lc-statement-text" data-reveal="fade">
            {t.statement.a} <InlinePhotos set={0} /> <em>{t.statement.aEm}</em> {t.statement.b} <InlinePhotos set={1} /> <em>{t.statement.bEm}</em> <InlinePhotos set={2} /> <em>{t.statement.cEm}</em>
          </p>
        </section>

        {/* 5 · Bento --------------------------------------------------------- */}
        <section id="todo" className="lc-section lc-paper" aria-labelledby="lc-todo-title">
          <div className="lc-container">
            <p className="lc-kicker lc-kicker--clay">{bento.kicker}</p>
            <h2 id="lc-todo-title" className="lc-display lc-h2" data-reveal="words"><RevealWords>{bento.title.pre}<em>{bento.title.em}</em></RevealWords></h2>
            <p className="lc-sub">{bento.sub}</p>
            <ul className="lc-bento">
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><UsersIcon aria-hidden="true" /></span>{bento.guests.title}</h3>
                <p>{bento.guests.body}</p>
                <div className="lc-live" aria-hidden="true">
                  <div className="lc-live-head">
                    <span className="lc-live-count"><b className="lc-live-num" style={{ "--lc-n": DEMO_CONFIRMED } as React.CSSProperties} /> {bento.guests.confirmed}</span>
                    <span className="lc-live-of">{bento.guests.of(DEMO_INVITED)}</span>
                  </div>
                  <span className="lc-live-bar"><i style={{ width: `${Math.round((DEMO_CONFIRMED / DEMO_INVITED) * 100)}%` }} /></span>
                  <div className="lc-mini-rows lc-live-rows">
                    {DEMO_GUESTS.map((g, i) => (
                      <span key={g.name} style={{ "--row": i } as React.CSSProperties}>
                        <b>{g.invited}</b> {t.guests.names[i]}
                        <span className="lc-live-state"><i data-s="env">{t.guests.sent}</i><i data-s={g.confirmed ? "si" : "ab"}>{g.confirmed ? t.guests.confirmed(g.confirmed) : t.guests.opened}</i></span>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><MessageCircleIcon aria-hidden="true" /></span>{bento.whatsapp.title}</h3>
                <p>{bento.whatsapp.body}</p>
                <div className="lc-wa" aria-hidden="true">
                  <div className="lc-wa-head"><span className="lc-wa-avatar">M</span><b>Marta López</b><span className="lc-wa-edit"><PencilIcon width={12} height={12} strokeWidth={2} /> {bento.whatsapp.edit}</span></div>
                  <span className="lc-wa-typing" aria-hidden="true"><i /><i /><i /></span>
                  <div className="lc-wa-bubble">
                    <p>{bento.whatsapp.message}<u>vinklo.es/b/lucia-y-juan?invitacion=…</u></p>
                    <p>{bento.whatsapp.signature}</p>
                    <small>12:04</small>
                  </div>
                </div>
              </li>
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><CalendarClockIcon aria-hidden="true" /></span>{bento.day.title}</h3>
                <p>{bento.day.body}</p>
                <div className="lc-day" aria-hidden="true">
                  <div className="lc-day-place">
                    <span className="lc-day-pin" />
                    <span><b>Finca La Alquería</b><small>{bento.day.town}</small></span>
                    <span className="lc-day-go">{bento.day.go}</span>
                  </div>
                  <ol className="lc-mini-rail lc-day-rail">
                    {bento.day.agenda.map(([time, label], i) => (
                      <li key={label} style={{ "--row": i } as React.CSSProperties}><small>{time}</small>{label}</li>
                    ))}
                  </ol>
                  <span className="lc-day-cal">{bento.day.calendar}</span>
                </div>
              </li>
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><MailOpenIcon aria-hidden="true" /></span>{bento.envelope.title}</h3>
                <p>{bento.envelope.body}</p>
                {/* Sobre de verdad (14-oct-2026): cerrado con el lacre y las
                iniciales; se abre, asoma la tarjeta y vuelve a cerrarse, en
                bucle. Sin movimiento: quieto y cerrado, con su lacre. */}
                <div className="lc-mini-envelope" aria-hidden="true">
                  <div className="lc-menv">
                    <span className="lc-menv-back" />
                    <span className="lc-mini-card"><span>Lucía <em>&amp;</em> Juan</span></span>
                    <span className="lc-menv-pocket" />
                    <span className="lc-mini-flap" />
                    <span className="lc-seal lc-seal--sm lc-menv-seal"><span>L<em>&amp;</em>J</span></span>
                  </div>
                </div>
              </li>
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><BellRingIcon aria-hidden="true" /></span>{bento.remind.title}</h3>
                <p>{bento.remind.body}</p>
                <div className="lc-mini-rows">
                  <span><b>1</b> {bento.remind.rows[0]}</span>
                  <span><b>1</b> {bento.remind.rows[1]}</span>
                </div>
              </li>
              <li className="lc-card" data-reveal="rise" data-reveal-group="bento">
                <h3><span className="lc-card-icon"><LayoutGridIcon aria-hidden="true" /></span>{bento.tables.title}</h3>
                <p>{bento.tables.body}</p>
                <div className="lc-mini-tables"><span>8/10</span><span>10/10</span><span data-over="">11/10</span></div>
              </li>
            </ul>
          </div>
        </section>

        {/* 7 · Una cosa más (regalos, próximamente) ------------------------- */}
        <section id="regalos" className="lc-section lc-paper lc-more" aria-labelledby="lc-more-title">
          <div className="lc-container lc-more-inner" data-reveal="fade">
            <p className="lc-kicker lc-kicker--clay lc-more-kicker">{t.gifts.kicker} <span className="lc-soon">{t.gifts.soon}</span></p>
            <h2 id="lc-more-title" className="lc-display lc-h2">{t.gifts.title.pre}<em>{t.gifts.title.em}</em></h2>
            {t.gifts.subs.map((sub) => <p key={sub} className="lc-sub">{sub}</p>)}
            <GiftsNotify locale={locale} />
          </div>
        </section>

        {/* 8 · Preguntas ------------------------------------------------------ */}
        <section id="preguntas" className="lc-section lc-paper lc-faq" aria-labelledby="ll-faq-title">
          <div className="lc-container lc-faq-grid">
            <div className="lc-faq-head" data-reveal="fade">
              <h2 id="ll-faq-title" className="lc-display lc-h2">{t.faq.title.pre}<em>{t.faq.title.em}</em></h2>
              <p className="lc-sub">{t.faq.askPre}<a href={`mailto:${BRAND_CONTACT_EMAIL}`}>{BRAND_CONTACT_EMAIL}</a>{t.faq.askPost}</p>
            </div>
            <div className="lc-faq-list">
              {t.faq.items.map((faq) => (
                <details className="lc-faq-item" key={faq.q}>
                  <summary>
                    <span>{faq.q}</span>
                    <span className="ll-faq-icon" aria-hidden="true" />
                  </summary>
                  <p>{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <LandingFinale locale={locale} />
      <LandingMotion />
    </div>
  );
}

/** Fotos que se suceden dentro de la frase (fundido + acercamiento lento). Solo CSS. */
const INLINE_SETS = [
  ["1460978812857-470ed1c77af0", "1494774157365-9e04c6720e47", "1606800052052-a08af7148866"],
  ["1729257973345-91a99bd19e9b", "1520854221256-17451cc331bf", "1465495976277-4387d4b0b4c6"],
  ["1516589178581-6cd7833ae3b2", "1754966447282-b56909233452", "1519379169146-d4b170447caa"],
] as const;

function InlinePhotos({ set }: { set: 0 | 1 | 2 }) {
  return (
    <span className="lc-inline-img" aria-hidden="true" style={{ "--lc-offset": `${set * -2.6}s` } as React.CSSProperties}>
      {INLINE_SETS[set].map((id, i) => (
        <span key={id} className="lc-inline-frame" style={{ backgroundImage: `url(/demo/s/${id}.webp)`, "--lc-i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}
