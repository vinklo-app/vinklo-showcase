import { NacarBackground } from "@/components/brand/nacar-background";
import Link from "next/link";
import { Children, cloneElement, isValidElement } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";
import type { Locale } from "@/components/landing/copy";
import "./read-mode.css";

/**
 * Modo Read (refresh 2026-10-03): plantilla de lectura compartida por las
 * guías y los documentos legales. Server components, cero JS en cliente.
 * Vive en components/guias/ porque es la única carpeta de componentes del
 * área E; candidata a components/read/ cuando se autorice.
 */

export type TocItem = { id: string; label: string };

/* ----------------------------------------------------------------------
   Utilidades de texto (servidor)
   ---------------------------------------------------------------------- */

/** Texto visible de un árbol React (strings y números, recursivo). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

/** `¿Cuánto se da en una boda?` → `cuanto-se-da-en-una-boda`. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Minutos de lectura calculados de verdad sobre el texto renderizado
 * (≈200 palabras/min en castellano). Nunca inventado: si no hay texto,
 * no hay cifra.
 */
export function readingMinutes(text: string): number | null {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 40) return null;
  return Math.max(1, Math.round(words / 200));
}

/* ----------------------------------------------------------------------
   Armazón
   ---------------------------------------------------------------------- */

export function ReadShell({
  eyebrow,
  title,
  lead,
  meta,
  toc,
  tocLabel = "Contenido",
  wide = false,
  children,
  footer,
  locale = "es",
  language,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** Línea de metadatos bajo el titular (fecha, tiempo de lectura…). */
  meta?: ReactNode[];
  toc?: TocItem[];
  tocLabel?: string;
  /** Columna de 72ch sin índice (listados). */
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** Idioma de la cabecera y enlace a la otra versión (/preguntas ↔ /en/faq). */
  locale?: Locale;
  language?: ComponentProps<typeof SiteHeader>["language"];
}) {
  const hasToc = Boolean(toc && toc.length > 0);
  const layout = [
    "rd-layout",
    !hasToc && (wide ? "rd-layout--wide" : "rd-layout--single"),
  ]
    .filter(Boolean)
    .join(" ");
  const metaItems = (meta ?? []).filter(Boolean);

  return (
    <>
      <NacarBackground />
      <SiteHeader locale={locale} language={language} />
      <main className="rd-page">
        <div className="rd-wrap">
          <div className={layout}>
            <header className="rd-head">
              <p className="font-label rd-eyebrow">{eyebrow}</p>
              <h1 className="rd-h1">{title}</h1>
              {lead ? <p className="rd-lead">{lead}</p> : null}
              {metaItems.length > 0 ? (
                <p className="rd-meta">
                  {metaItems.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </p>
              ) : null}
            </header>

            {hasToc ? (
              <aside className="rd-aside">
                <Toc label={tocLabel} items={toc!} />
              </aside>
            ) : null}

            <div className="rd-article">
              {children}
              {footer}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export function Toc({ label, items }: { label: string; items: TocItem[] }) {
  return (
    <nav className="rd-toc" aria-label={label}>
      <p className="font-label rd-toc-label">{label}</p>
      <ol>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`}>{it.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ----------------------------------------------------------------------
   Guías: índice a partir de los <h2> hijos directos
   ---------------------------------------------------------------------- */

/**
 * Recorre los hijos directos; a cada <h2> le inyecta un id (slug de su
 * texto, único) y lo apunta en el índice. No toca el contenido.
 */
export function withHeadingIds(children: ReactNode): {
  nodes: ReactNode[];
  toc: TocItem[];
} {
  const toc: TocItem[] = [];
  const seen = new Map<string, number>();
  const nodes = Children.toArray(children).map((child) => {
    if (!isValidElement(child) || child.type !== "h2") return child;
    const el = child as ReactElement<{ id?: string; children?: ReactNode }>;
    const label = textOf(el.props.children).replace(/\s+/g, " ").trim();
    let id = el.props.id ?? slugify(label);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n + 1}`;
    toc.push({ id, label });
    return cloneElement(el, { id });
  });
  return { nodes, toc };
}

/* ----------------------------------------------------------------------
   Legal
   ---------------------------------------------------------------------- */

/** Sección numerada de un documento legal: <section id> + <h2>. */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

/** Índice a partir de las <LegalSection> hijas directas. */
export function tocFromSections(children: ReactNode): TocItem[] {
  const items: TocItem[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<{ id: string; title: string }>(child) && child.type === LegalSection) {
      items.push({ id: child.props.id, label: child.props.title });
    }
  });
  return items;
}

const LEGAL_DOCS = [
  { href: "/aviso-legal", label: "Aviso legal" },
  { href: "/privacidad", label: "Política de privacidad" },
  { href: "/terminos", label: "Términos y condiciones" },
] as const;

/**
 * Armazón de documento legal: eyebrow «Legal», titular, fecha, índice
 * lateral y pie con los otros documentos. El texto legal es de las
 * páginas; aquí solo hay presentación.
 */
export function LegalShell({
  href,
  title,
  meta,
  children,
}: {
  href: (typeof LEGAL_DOCS)[number]["href"];
  title: string;
  /** Texto literal de la línea de fecha («Última actualización: …»). */
  meta: string;
  children: ReactNode;
}) {
  return (
    <ReadShell
      eyebrow="Legal"
      title={title}
      meta={[meta]}
      toc={tocFromSections(children)}
      tocLabel="Contenido"
      footer={
        <nav className="rd-foot" aria-label="Documentos legales">
          <Link href="/">Volver al inicio</Link>
          {LEGAL_DOCS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              aria-current={d.href === href ? "page" : undefined}
            >
              {d.label}
            </Link>
          ))}
        </nav>
      }
    >
      <div className="rd-prose">{children}</div>
    </ReadShell>
  );
}

/**
 * Dato que el titular debe rellenar antes de publicar ([NIF], [DOMICILIO]…).
 * En producción es texto plano; en desarrollo se resalta para que no se
 * cuele sin rellenar. El texto no cambia en ningún caso.
 */
export function Placeholder({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") return <span>{children}</span>;
  return (
    <span className="rd-ph" title="Dato pendiente de rellenar por el titular">
      {children}
    </span>
  );
}
