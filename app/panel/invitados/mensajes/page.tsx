import { redirect } from "next/navigation";
import { PageHead } from "@/components/panel/page-head";
import { MessageEditorLive } from "@/components/panel/messages-wired";
import { getMessageTemplates } from "@/lib/actions/messages";
import { getCurrentWedding } from "@/lib/data/current-wedding";

export const metadata = { title: "Mensajes de WhatsApp" };

/**
 * Editor de los mensajes de invitación, recordatorio y agradecimiento. La vista previa usa
 * el nombre de un invitado real de la lista (o «Marta» si aún no hay nadie).
 */
export default async function MensajesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");
  const { supabase, wedding } = context;

  const [templates, sample] = await Promise.all([
    getMessageTemplates(),
    supabase.from("wedding_guests").select("name").eq("wedding_id", wedding.id).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle(),
  ]);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <main className="pn-wrap pn-page pn-page--tight">
      <PageHead eyebrow="Invitados · Mensajes" back={{ href: "/panel/invitados", label: "Invitados" }} title={<>Mensajes de <em>WhatsApp</em></>}
        lead="Lo que se abre en vuestro WhatsApp para cada persona." />
      {templates.ok ? (
        <MessageEditorLive
          templates={{ ...templates.templates, thanks: templates.thanks }}
          context={templates.context}
          sampleName={sample.data?.name?.trim() || "Marta"}
          sampleLink={`${baseUrl}/b/${wedding.slug}?invitacion=…`}
          initialKind={params.tipo === "recordatorio" ? "reminder" : params.tipo === "agradecimiento" ? "thanks" : "invitation"}
        />
      ) : (
        <p role="alert" className="pn-note pn-note--warn">{templates.error}</p>
      )}
    </main>
  );
}
