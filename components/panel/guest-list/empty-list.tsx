"use client";

import Link from "next/link";
import { CheckIcon, PlusIcon, SearchIcon, TagIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import type { GuestListFilter } from "@/lib/messages/filters";
import { FILTER_EMPTY } from "@/components/panel/reminders";
import { ALL_GROUPS, type GroupFilter } from "@/lib/crm/groups";

export function EmptyList({ filter, query, clearHref, onAdd, onBulk, onExcel, group = ALL_GROUPS, tagged = null }: { filter: GuestListFilter; query: string; clearHref: string; onAdd: () => void; onBulk?: () => void; onExcel?: () => void; group?: GroupFilter; tagged?: string | null }) {
  if (tagged && group.kind === "all" && filter === "todos" && !query) {
    return (
      <EmptyState icon={TagIcon} title={<>Nadie con «{tagged}»</>} body="Añadid la etiqueta desde la ficha de cada invitado o, en la lista completa, tocad «Seleccionar» y «Etiquetar…».">
        <Link href={clearHref} className="pn-link pn-press">Ver toda la lista</Link>
      </EmptyState>
    );
  }
  if (group.kind !== "all" && filter === "todos" && !query) {
    return (
      <EmptyState icon={UsersIcon} title={group.kind === "named" ? <>Aún no hay nadie en «{group.name}»</> : <>Todos tienen <em>grupo.</em></>}
        body={group.kind === "named" ? "Añadid a alguien con este grupo o, en la lista completa, tocad «Seleccionar» y «Mover a grupo…»." : "Cada invitado de vuestra lista está en algún grupo."}>
        {group.kind === "named" && <button type="button" onClick={onAdd} className="pn-btn pn-btn--clay pn-press"><PlusIcon aria-hidden="true" className="size-4" />Añadir a «{group.name}»</button>}
        <Link href={clearHref} className="pn-link pn-press">Ver toda la lista</Link>
      </EmptyState>
    );
  }
  if (query) {
    return (
      <EmptyState icon={SearchIcon} title={<>Nadie coincide con «{query}»</>} body={filter === "todos" ? "Probad con otro nombre o solo con el apellido." : "Probad con otro nombre o quitad el filtro: puede que esa persona esté en otro."}>
        <Link href={clearHref} className="pn-link pn-press">Ver toda la lista</Link>
      </EmptyState>
    );
  }
  if (filter !== "todos") {
    const copy = FILTER_EMPTY[filter];
    return (
      <EmptyState icon={CheckIcon} title={copy.title} body={copy.body}>
        <Link href={clearHref} className="pn-link pn-press">Ver toda la lista</Link>
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={UsersIcon} title={<>Añadid a vuestro <em>primer invitado.</em></>}
      body="Elegid un contacto o escribidlo, cread su enlace personal y compartidlo por WhatsApp. Después confirmad el envío para contar a ese destinatario, aunque aún no haya respondido. Cada enlace permite responder sin crear una cuenta.">
      <button type="button" onClick={onAdd} className="pn-btn pn-btn--clay pn-press">
        <PlusIcon aria-hidden="true" className="size-4" />Añadir el primer invitado
      </button>
      {onBulk && <button type="button" onClick={onBulk} className="pn-link pn-press">¿Ya tenéis la lista? Pegadla entera</button>}
      {onExcel && <button type="button" onClick={onExcel} className="pn-link pn-press">¿La tenéis en Excel? Importadla</button>}
    </EmptyState>
  );
}
