import Link from "next/link";
import { ChevronLeftIcon, type LucideIcon } from "lucide-react";

/*
 * Piezas del lenguaje de la landing (2026-10-05) para el panel, server-safe:
 * rótulo mono en versalitas espaciadas (`.pn-eyebrow` = `.ll-eyebrow`),
 * titular Playfair con UNA cursiva arcilla como énfasis (<em>), entradilla
 * con aire. Sin animación de entrada: el panel se abre a diario (regla de
 * frecuencia); solo los pulsables responden con scale(.97).
 */

export function PageHead({ eyebrow, title, lead, back, children }: {
  eyebrow: string;
  /** Titular; la parte en cursiva arcilla va en <em>. */
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Vuelta a la página madre (subpáginas de Invitados). */
  back?: { href: string; label: string };
  /** Líneas extra bajo la entrada (plazos, avisos). */
  children?: React.ReactNode;
}) {
  return (
    <header className="pn-head">
      {back && (
        <Link href={back.href} className="pn-link pn-press pn-muted pn-head-back"><ChevronLeftIcon aria-hidden="true" className="size-4" />{back.label}</Link>
      )}
      <p className="pn-eyebrow">{eyebrow}</p>
      <h1 className="pn-display pn-h1">{title}</h1>
      {lead && <p className="pn-lead">{lead}</p>}
      {children}
    </header>
  );
}

/** Icono lucide en cuadro teñido de arcilla (`.ll-crm-icon` en papel). */
export function IconTile({ icon: Icon, tone = "clay" }: { icon: LucideIcon; tone?: "clay" | "ink" }) {
  return (
    <span className="pn-icon-tile" data-tone={tone} aria-hidden="true">
      <Icon width={20} height={20} strokeWidth={1.6} />
    </span>
  );
}

/**
 * Estado vacío que vende el siguiente paso: icono, titular display con su
 * cursiva, una frase de por qué y UNA acción principal (arcilla) más, como
 * mucho, una secundaria en enlace.
 */
export function EmptyState({ icon, title, body, children, as: Tag = "div", titleAs: Title = "h2" }: {
  icon: LucideIcon; title: React.ReactNode; body: React.ReactNode; children?: React.ReactNode;
  as?: "div" | "section"; titleAs?: "h2" | "h3";
}) {
  return (
    <Tag className="pn-empty">
      <IconTile icon={icon} />
      <Title className="pn-display pn-h2">{title}</Title>
      <p className="pn-empty-body">{body}</p>
      {children && <div className="pn-empty-actions">{children}</div>}
    </Tag>
  );
}
