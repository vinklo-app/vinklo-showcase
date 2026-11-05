"use client";

import type { GroupFilter } from "@/lib/crm/groups";
import type { SideFilter } from "@/lib/crm/tags";
/**
 * Cableado real de las piezas de mensajes con las server actions de
 * lib/actions/messages.ts y lib/actions/guests.ts (el borrador del panel
 * monta los mismos componentes con acciones de mentira).
 */
import { confirmSeriesInvitationSent, createReminderLink, createSeriesInvitation } from "@/lib/actions/guests";
import { confirmReminderSent, exportGuestsCsv, resetMessageTemplate, saveMessageTemplate, setRemindersOptOut } from "@/lib/actions/messages";
import type { GuestListFilter } from "@/lib/messages/filters";
import type { MessageContext, TemplateKind } from "@/lib/messages/templates";
import { GuestCsvButton } from "@/components/panel/guest-csv-button";
import { GiftCsvButton } from "@/components/panel/gift-csv-button";
import { exportGiftsCsv } from "@/lib/actions/gifts";
import { MessageEditor, type MessageEditorActions, type SavedTemplate } from "@/components/panel/message-editor";
import { ReminderQueue, type ReminderPerson, type ReminderQueueActions } from "@/components/panel/reminder-queue";
import type { QueueState } from "@/components/panel/reminders";
import { InvitationSeries, type InvitationSeriesActions } from "@/components/panel/invitation-series";
import type { InvitationQueueItem } from "@/lib/messages/invitation-series";

const editorActions: MessageEditorActions = { save: saveMessageTemplate, reset: resetMessageTemplate };
const reminderTemplateActions = { save: (body: string) => saveMessageTemplate("reminder", body), reset: () => resetMessageTemplate("reminder") };
const queueActions: ReminderQueueActions = {
  createLink: createReminderLink,
  confirm: confirmReminderSent,
  optOut: (guestId) => setRemindersOptOut(guestId, true),
};

const seriesActions: InvitationSeriesActions = { createLink: createSeriesInvitation, confirm: confirmSeriesInvitationSent };
const invitationTemplateActions = { save: (body: string) => saveMessageTemplate("invitation", body), reset: () => resetMessageTemplate("invitation") };

export function MessageEditorLive(props: { templates: Record<TemplateKind, SavedTemplate>; context: MessageContext; sampleName: string; sampleLink: string; initialKind?: TemplateKind }) {
  return <MessageEditor {...props} actions={editorActions} />;
}

export function ReminderQueueLive({ basePath = "/panel/invitados/recordatorios", ...props }: { items: ReminderPerson[]; state: QueueState; template: string | null; context: MessageContext; linkPreview: string; basePath?: string }) {
  return <ReminderQueue {...props} basePath={basePath} listHref="/panel/invitados" actions={queueActions} templateActions={reminderTemplateActions} />;
}

export function GuestCsvLive({ filter, query, group, tag, side, sideLabel }: { filter: GuestListFilter; query: string; group?: GroupFilter; tag?: string | null; side?: SideFilter; sideLabel?: string }) {
  return <GuestCsvButton filter={filter} query={query} group={group} tag={tag} side={side} sideLabel={sideLabel} exportCsv={exportGuestsCsv} />;
}

/** CSV de regalos y agradecimientos (20261026100000): en /panel y junto a «Exportar CSV» en Invitados. */
export function GiftCsvLive({ compact = false }: { compact?: boolean }) {
  return <GiftCsvButton exportCsv={exportGiftsCsv} compact={compact} />;
}

export function InvitationSeriesLive(props: { items: InvitationQueueItem[]; state: QueueState; template: string | null; context: MessageContext; linkPreview: string; basePath: string; withoutPhone: number }) {
  return <InvitationSeries {...props} listHref="/panel/invitados" actions={seriesActions} templateActions={invitationTemplateActions} />;
}
