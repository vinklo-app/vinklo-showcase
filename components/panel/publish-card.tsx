"use client";

/**
 * Tarjeta de publicación de la web (panel › Vuestra web).
 *
 * Muestra el estado del borrador frente a la web publicada y permite
 * publicar (optimistic locking con `draftVersion`) o retirar la web. La
 * lógica vive en las server actions de lib/actions/site.ts; aquí solo UI.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { publishSite, unpublishSite, type SiteEditorState } from "@/lib/actions/site";
import type { SiteDocumentIssue } from "@/lib/site-document";

type Feedback =
  | { kind: "success"; text: string }
  | { kind: "conflict"; text: string }
  | { kind: "invalid"; text: string; issues: SiteDocumentIssue[] }
  | { kind: "error"; text: string };

function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(date);
}

export function PublishCard({ state }: { state: SiteEditorState }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [pending, startTransition] = useTransition();

  // Cuatro estados. «Retirada»: hubo publicación pero el puntero está a null,
  // la web devuelve 404 a los invitados hasta volver a publicar.
  const withdrawn = state.publishedAt !== null && state.publishedRevisionId === null;
  const published = state.publishedRevisionId !== null;
  const publishedLabel = state.publishedAt ? formatPublishedAt(state.publishedAt) : "";
  const status = withdrawn
    ? { title: "Retirada", detail: "Vuestro enlace no se abre para los invitados. Volved a publicar cuando queráis mostrar la web." }
    : !published
      ? { title: "Sin publicar", detail: "Aún no hay una versión publicada. Publicad cuando los datos estén listos." }
      : state.hasUnpublishedChanges
        ? { title: "Cambios sin publicar", detail: `Última publicación: ${publishedLabel}. Lo que ven vuestros invitados no cambia hasta que publiquéis.` }
        : { title: `Publicada el ${publishedLabel}`, detail: "Vuestros invitados ven esta versión." };

  function publish() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await publishSite({ baseVersion: state.draftVersion });
        if (result.ok) {
          setFeedback({ kind: "success", text: "Web publicada. Vuestro enlace muestra esta versión." });
          router.refresh();
          return;
        }
        if (result.code === "conflict") {
          setFeedback({ kind: "conflict", text: "Alguien ha guardado antes; recargad para ver la última versión." });
        } else if (result.code === "invalid") {
          setFeedback({ kind: "invalid", text: result.error || "Faltan datos para publicar.", issues: result.issues ?? [] });
        } else {
          setFeedback({ kind: "error", text: result.error || "No hemos podido publicar. Probad de nuevo." });
        }
      } catch {
        setFeedback({ kind: "error", text: "No hemos podido publicar. Revisad la conexión y probad de nuevo." });
      }
    });
  }

  function unpublish() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await unpublishSite();
        if (result.ok) {
          setConfirmUnpublish(false);
          setFeedback({ kind: "success", text: "Web retirada. Vuestro enlace dejará de abrirse hasta que la volváis a publicar." });
          router.refresh();
        } else {
          setFeedback({ kind: "error", text: result.error || "No hemos podido retirar la web. Probad de nuevo." });
        }
      } catch {
        setFeedback({ kind: "error", text: "No hemos podido retirar la web. Revisad la conexión y probad de nuevo." });
      }
    });
  }

  const canPublish = withdrawn || !published || state.hasUnpublishedChanges;

  return (
    <section aria-labelledby="publish-title" className="pn-rule border-t border-b py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="pn-label">Publicación</p>
          <h2 id="publish-title" className="pn-display pn-h2 mt-2">
            {status.title}
          </h2>
          <p className="pn-muted mt-2 max-w-md text-sm leading-relaxed">{status.detail}</p>
        </div>
        <Link href={`/b/${state.slug}`} className="pn-link pn-press" target="_blank" rel="noopener noreferrer">
          {published ? "Ver la web publicada" : "Ver vuestra web"}
        </Link>
      </div>

      <p className="pn-muted mt-4 text-xs">
        Enlace: <span className="font-mono">/b/{state.slug}</span>
      </p>

      {feedback && (
        <div
          role={feedback.kind === "success" ? "status" : "alert"}
          className={`pn-note mt-4 ${feedback.kind === "success" ? "pn-note--ok" : "pn-note--warn"}`}
        >
          <p>{feedback.text}</p>
          {feedback.kind === "invalid" && feedback.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-tinta/80">
              {feedback.issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          )}
          {feedback.kind === "conflict" && (
            <button type="button" onClick={() => router.refresh()} className="pn-link pn-press mt-1">
              Recargar
            </button>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={publish}
          data-publish-primary=""
          disabled={pending || !canPublish}
          className="pn-btn pn-btn--clay pn-press"
        >
          {pending ? "Un momento…" : withdrawn ? "Volver a publicar" : published ? "Publicar cambios" : "Publicar nuestra web"}
        </button>
        {!canPublish && <span className="pn-muted text-sm">No hay cambios pendientes.</span>}
        {published && !confirmUnpublish && (
          <button type="button" onClick={() => setConfirmUnpublish(true)} disabled={pending} className="pn-link pn-press">
            Retirar la web
          </button>
        )}
      </div>

      {published && confirmUnpublish && (
        <div role="group" aria-label="Confirmar retirada" className="pn-rule-strong mt-4 border-l-2 pl-4 text-sm leading-relaxed">
          <p>Vuestro enlace dejará de abrirse hasta que la volváis a publicar. El borrador y las respuestas de vuestros invitados se conservan.</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <button type="button" onClick={unpublish} disabled={pending} className="pn-btn pn-btn--danger pn-btn--sm pn-press">
              {pending ? "Retirando…" : "Sí, retirar la web"}
            </button>
            <button type="button" onClick={() => setConfirmUnpublish(false)} disabled={pending} className="pn-link pn-press">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
