import Link from "next/link";

import { LazoIcon } from "@/components/brand/icons";
import type { Locale } from "@/components/landing/copy";

const FOCUS_RING = "outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-clay";

/** Textos de la cabecera por idioma (1-nov-2026: /en/faq). */
const HEADER_COPY = {
  es: { nav: "Principal", home: "/", homeLabel: "vinklo, inicio", login: "Entrar", createShort: "Crear", create: "Crear nuestra web" },
  en: { nav: "Main", home: "/en", homeLabel: "vinklo, home", login: "Log in", createShort: "Create", create: "Create our website" },
} as const;

/** Enlace a la misma página en el otro idioma (solo donde existe). */
type LanguageLink = { href: string; lang: Locale; text: string; label: string };

/**
 * Header público compartido (v8 «Papel cálido», refresh 2026-10-03): wordmark,
 * «Entrar» y el CTA en tinta. Sin menú largo (spec §3). Lo usan la landing,
 * /guias y /precios; la misma estructura en todas las páginas públicas es la
 * señal que Google usa para elegir sitelinks.
 *
 * Por debajo de 480 px «Entrar» no cabe junto al CTA sin scroll horizontal;
 * se oculta aquí y sigue disponible en SiteFooter.
 *
 * Pasada nativa (2026-10-03): el layout raíz usa `viewport-fit=cover`, así
 * que los márgenes laterales respetan la muesca en horizontal
 * (`env(safe-area-inset-*)`). Con la letra del sistema al 200 % el CTA se
 * salía de la pantalla: ahora puede partirse en dos líneas y el wordmark no
 * encoge.
 *
 * Material (2026-10-05, principios Apple): la cabecera flota sobre el
 * contenido (sticky, translúcida con desenfoque) y su filete solo aparece al
 * desplazar. Estilos en `globals.css` (`.site-header`), con alternativa
 * opaca para transparencia reducida y contraste alto.
 *
 * 1-nov-2026: `locale` y, si la página tiene versión en el otro idioma,
 * `language` (ES · EN) junto a «Entrar».
 */
export function SiteHeader({ locale = "es", language }: { locale?: Locale; language?: LanguageLink }) {
  const t = HEADER_COPY[locale];
  return (
    <header className="site-header">
      <nav aria-label={t.nav} className="mx-auto flex min-h-[4.5rem] max-w-6xl items-center justify-between gap-4 px-[max(1rem,env(safe-area-inset-left))] sm:px-[max(2rem,env(safe-area-inset-left))]">
        <Link
          href={t.home}
          prefetch={false}
          aria-label={t.homeLabel}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-[19px] font-bold tracking-[-0.02em] text-ink ${FOCUS_RING}`}
        >
          <LazoIcon className="size-6" aria-hidden="true" />
          <span aria-hidden="true">
            v<span className="text-clay">ı</span>nklo
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          {language && (
            <Link
              href={language.href}
              hrefLang={language.lang}
              lang={language.lang}
              aria-label={language.label}
              className={`u-hover-underline inline-flex min-h-11 shrink-0 items-center text-[13px] font-semibold tracking-[0.04em] text-ink/80 underline-offset-[0.3em] ${FOCUS_RING}`}
            >
              {language.text}
            </Link>
          )}
          <Link
            href="/login"
            className={`u-hover-underline inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-ink underline-offset-[0.3em] ${FOCUS_RING}`}
          >
            {t.login}
          </Link>
          <Link
            href="/crear"
            className={`u-pressable u-hover-dim inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-ciruela px-4 py-1.5 text-center text-sm leading-tight font-semibold text-balance text-white [-webkit-tap-highlight-color:transparent] [touch-action:manipulation] select-none ${FOCUS_RING}`}
          >
            <span className="min-[480px]:hidden">{t.createShort}</span>
            <span className="hidden min-[480px]:inline">{t.create}</span>
          </Link>
        </div>
      </nav>
    </header>
  );
}
