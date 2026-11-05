"use client";

import Link from "next/link";
import { useMotionValueEvent, useScroll } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BrandCurve, LazoIcon } from "@/components/brand/icons";
import { landingCopy, type Locale } from "@/components/landing/copy";

/**
 * Cabecera de la landing al estilo Cordially (2026-10-06): flota sobre el
 * contenido, transparente y en claro sobre los capítulos oscuros, y en tinta
 * sobre los de papel. Sabe qué hay debajo mirando qué sección con
 * `data-tone="dark"` ocupa su franja (IntersectionObserver, sin scroll
 * listeners).
 *
 * 1-nov-2026: enlace a la otra versión (ES · EN) junto a «Entrar».
 */
export function LandingNav({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale).nav;
  const home = landingCopy(locale).home;
  const [onDark, setOnDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Tono de la barra: lo que hay justo debajo de ella, en cada scroll (y
    // cuando un capítulo cambia de tono, como «Hacedla vuestra»).
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      const under = document.elementsFromPoint(window.innerWidth / 2, 72).find((el) => !el.closest(".lc-nav"));
      setOnDark(Boolean(under?.closest('[data-tone="dark"]')));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header ref={ref} className="lc-nav" data-on={onDark ? "dark" : "light"} data-scrolled={scrolled ? "" : undefined}>
      <nav aria-label={t.label} className="lc-nav-inner">
        <Link href={home} aria-label={t.homeLabel} className="lc-brand">
          <span className="lc-brand-word"><LazoIcon aria-hidden="true" /><span>v<span className="lc-brand-i">ı</span>nklo</span></span>
          
        </Link>
        <div className="lc-nav-links">
          <a href="#estilos">{t.templates}</a>
          <a href="#preguntas">{t.faq}</a>
        </div>
        <div className="lc-nav-actions">
          <Link href={t.language.href} hrefLang={t.language.lang} lang={t.language.lang} aria-label={t.language.label} className="lc-nav-login lc-nav-lang">{t.language.text}</Link>
          <Link href="/login" prefetch={false} className="lc-nav-login">{t.login}</Link>
          <Link href="/crear" className="lc-pill lc-pill--solid"><span className="lc-only-sm">{t.createShort}</span><span className="lc-hide-sm-inline">{t.create}</span></Link>
        </div>
      </nav>
    </header>
  );
}

/**
 * «Hacedla vuestra» (referencia Cordially «Make it yours»). Capítulo alto con
 * el contenido fijo (sticky): pasada la mitad, el interruptor se enciende solo
 * y el titular cambia a la respuesta (6-oct-2026: «que se ponga lo otro sin
 * tener que pulsar»). Al volver hacia arriba se apaga. Se puede seguir
 * pulsando. Marca v9 (9-oct-2026): los dos estados son claros (perla y un
 * tinte perla-2); los distinguen el titular, el fondo y el propio control
 * (pista ciruela, botón a la derecha con su marca). Sin foto de fondo ni
 * dibujos: una sola curva de marca al fondo, que en móvil se retira.
 * Reduced motion: sin desplazamientos; el interruptor sigue cambiando.
 * 14-oct-2026 («muy brusca»): los dos textos viven apilados en la misma
 * celda, así la altura no salta (2 líneas ↔ 3), y se cruzan: el que se va
 * sale hacia arriba y el que llega entra un instante después. Histéresis en
 * el umbral para que no parpadee al detener el scroll justo en la mitad.
 */
export function LandingSwitchSection({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale).switcher;
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // Se enciende pasado el 45 % y solo se apaga por debajo del 35 %.
  useMotionValueEvent(scrollYProgress, "change", (v) => setOn((prev) => (prev ? v > 0.35 : v > 0.45)));
  // Al cambiar de estado, la barra de arriba vuelve a mirar qué tiene debajo.
  useEffect(() => { window.dispatchEvent(new Event("scroll")); }, [on]);
  // El texto que se va sale hacia arriba durante su fundido (lc-swap-item).
  const [leaving, setLeaving] = useState<boolean | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setLeaving(!on);
    const t = window.setTimeout(() => setLeaving(null), 320);
    return () => window.clearTimeout(t);
  }, [on]);

  return (
    <section ref={ref} className="lc-switch-section" data-on={on ? "" : undefined} aria-label={t.label}>
      <div className="lc-switch-sticky">
        <BrandCurve className="lc-switch-curve" />
        <div className="lc-switch" data-on={on ? "" : undefined}>
          <button type="button" className="lc-switch-toggle" role="switch" aria-checked={on} onClick={() => setOn((v) => !v)}>
            <span className="lc-switch-label">{t.label}</span>
            <span className="lc-switch-track" aria-hidden="true">
              <span className="lc-switch-thumb">
                <svg viewBox="0 0 12 12" fill="none"><path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </span>
          </button>
          <h2 className="lc-switch-title lc-swap-stack" aria-live="polite">
            <span className="lc-swap-item" data-active={on ? undefined : ""} data-leaving={leaving === false ? "" : undefined} aria-hidden={on}>
              {t.off.pre}<em>{t.off.em}</em>{t.off.post}
            </span>
            <span className="lc-swap-item" data-active={on ? "" : undefined} data-leaving={leaving === true ? "" : undefined} aria-hidden={!on}>
              {t.on.pre}<em>{t.on.em}</em>{t.on.post}
            </span>
          </h2>
          <p className="lc-switch-sub lc-swap-stack">
            <span className="lc-swap-item" data-active={on ? undefined : ""} data-leaving={leaving === false ? "" : undefined} aria-hidden={on}>
              {t.offSub}
            </span>
            <span className="lc-swap-item" data-active={on ? "" : undefined} data-leaving={leaving === true ? "" : undefined} aria-hidden={!on}>
              {t.onSub}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
