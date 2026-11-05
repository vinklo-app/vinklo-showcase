"use client";

import { addGuest, updateGuest, deleteGuest, deleteGuests, previewGuestsDeletion, setGuestsStatus, listGuestsInFilter, createGuestInvitation, createReminderLink, confirmInvitationSent, bulkCreateGuests, listGuestContacts, setGuestsGroup, searchGuestDirectory, setGuestsTags, setGuestsSide, setGuestsMaxCompanions, renameTag } from "@/lib/actions/guests";
import { ALL_GROUPS, type GroupFilter } from "@/lib/crm/groups";
import type { GuestTagSummary, Partners, SideFilter } from "@/lib/crm/tags";
import { saveMessageTemplate, setRemindersOptOut } from "@/lib/actions/messages";
import { addGuestApart, getGuestExtras, removeGuestApart, saveGuestCompanions } from "@/lib/actions/companions";
import { createGift, deleteGift, setGiftThanked, setGuestNoGift, updateGift } from "@/lib/actions/gifts";
import type { CrmActions, Gift } from "@/lib/crm/contract";
import type { GuestOption, ThanksMessage } from "@/components/panel/guest-gifts";
import type { GuestListFilter } from "@/lib/messages/filters";
import { GuestList, type GuestActions, type GuestRow, type InvitationMessage } from "@/components/panel/guest-list";
import { importGuestsFromExcel } from "@/lib/actions/guest-excel";
import { GuestViewToggle } from "@/components/panel/guest-table";
import { GUEST_VIEW_COOKIE, type GuestView } from "@/lib/crm/guest-view";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type { GuestRow };

/**
 * Cableado real de /panel/invitados: la lista de presentación con las server
 * actions de lib/actions, incluida la importación masiva («Añadir varios» e
 * «Importar contactos»). Sustituye a GuestTracker en esa página.
 */
const giftActions: CrmActions = { createGift, updateGift, deleteGift, setGiftThanked, setGuestNoGift };

const actions: GuestActions = {
  add: addGuest,
  update: updateGuest,
  remove: deleteGuest,
  createInvitation: createGuestInvitation,
  createReminderLink,
  confirmSent: confirmInvitationSent,
  saveTemplate: saveMessageTemplate,
  setRemindersOptOut,
  bulkCreate: bulkCreateGuests,
  listContacts: listGuestContacts,
  gifts: giftActions,
  setGroup: setGuestsGroup,
  setTags: setGuestsTags,
  setSide: setGuestsSide,
  setMaxCompanions: setGuestsMaxCompanions,
  renameTag,
  searchGuests: searchGuestDirectory,
  extras: { load: getGuestExtras, saveCompanions: saveGuestCompanions, addApart: addGuestApart, removeApart: removeGuestApart, searchGuests: searchGuestDirectory },
  importExcel: importGuestsFromExcel,
  removeMany: deleteGuests,
  previewRemove: previewGuestsDeletion,
  setStatus: setGuestsStatus,
};

/**
 * Lista / Tabla: guarda la elección en una cookie (un año, solo /panel) y
 * vuelve a pedir la página, que con «Tabla» carga todo el filtro activo.
 */
export function GuestViewSwitch({ view }: { view: GuestView }) {
  const router = useRouter();
  const [shown, setShown] = useState(view);
  const [source, setSource] = useState(view);
  const [, startTransition] = useTransition();
  if (view !== source) { setSource(view); setShown(view); }
  return (
    <GuestViewToggle view={shown} onChange={(next) => {
      setShown(next);
      document.cookie = `${GUEST_VIEW_COOKIE}=${next}; path=/panel; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
      startTransition(() => router.refresh());
    }} />
  );
}

export function GuestListLive({ guests, filter, query, openAddInitially = false, openBulkInitially = false, invitationMessage, toolbar, gifts, directory, thanksMessage, groups, group, clearHref, tagSummary, partners, tag, sideFiltered, side = null, total, limits, view }: {
  guests: GuestRow[]; filter: GuestListFilter; query: string; openAddInitially?: boolean; openBulkInitially?: boolean; invitationMessage?: InvitationMessage; toolbar?: React.ReactNode;
  gifts?: Gift[] | null; directory?: GuestOption[]; thanksMessage?: ThanksMessage;
  /** Grupos en uso (undefined = sin la migración de grupos) y el elegido en la URL. */
  groups?: string[]; group?: GroupFilter; clearHref?: string;
  /** Etiquetas en uso (undefined/null = sin la migración de etiquetas), la elegida y los nombres de la pareja. */
  tagSummary?: GuestTagSummary[] | null; partners?: Partners; tag?: string | null; sideFiltered?: boolean;
  /** Se ha podido leer el tope de acompañantes (20261021110000). */
  limits?: boolean;
  /** «Lista» o «Tabla». */
  view?: GuestView;
  /** Lado elegido (`?lado=`) y personas del filtro en todas las páginas («Elegir los N del filtro»). */
  side?: SideFilter; total?: number;
}) {
  // «Elegir los N del filtro» pregunta por el mismo filtro que pinta la página.
  const groupKey = JSON.stringify(group ?? ALL_GROUPS);
  const wired = useMemo<GuestActions>(() => ({
    ...actions,
    listFilter: () => listGuestsInFilter({ filter, query, group: JSON.parse(groupKey) as GroupFilter, tag: tag ?? null, side }),
  }), [filter, query, groupKey, tag, side]);
  return <GuestList guests={guests} actions={wired} side={side} total={total} filter={filter} query={query} openAddInitially={openAddInitially} openBulkInitially={openBulkInitially} invitationMessage={invitationMessage} toolbar={toolbar} gifts={gifts} directory={directory} thanksMessage={thanksMessage} groups={groups} group={group} clearHref={clearHref} tagSummary={tagSummary} partners={partners} tag={tag} sideFiltered={sideFiltered} limits={limits} view={view} />;
}
