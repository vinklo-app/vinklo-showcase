"use client";

/**
 * Aviso en la landing tras borrar la boda o la cuenta (plan maestro §5.10).
 * Lee la cookie corta que deja lib/actions/account.ts, la borra y enseña una
 * franja que se puede cerrar. En el servidor no pinta nada: la landing sigue
 * siendo estática.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { DELETION_NOTICE_COOKIE, DELETION_NOTICE_TEXT, readDeletionNotice, type DeletionNoticeKind } from "@/lib/deletion-notice";

const noopSubscribe = () => () => {};

// Se lee una vez por carga de página y se guarda: borrar la cookie después
// no cambia la instantánea (useSyncExternalStore la vuelve a pedir).
let snapshot: DeletionNoticeKind | null | undefined;
function readOnce(): DeletionNoticeKind | null {
  if (snapshot === undefined) snapshot = readDeletionNotice(document.cookie);
  return snapshot;
}

export function DeletionNotice() {
  const kind = useSyncExternalStore(noopSubscribe, readOnce, () => null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (kind) document.cookie = `${DELETION_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  }, [kind]);

  if (!kind || dismissed) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        insetInline: "16px",
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 60,
        maxWidth: "32rem",
        marginInline: "auto",
        display: "flex",
        gap: "12px",
        alignItems: "flex-start",
        padding: "14px 16px",
        borderRadius: "14px",
        background: "#2E2335",
        color: "#F8F7FA",
        fontSize: "15px",
        lineHeight: 1.45,
        boxShadow: "0 10px 30px rgba(36, 33, 42, 0.18)",
      }}
    >
      <p style={{ margin: 0, flex: 1 }}>{DELETION_NOTICE_TEXT[kind]}</p>
      <button
        type="button"
        onClick={() => {
          snapshot = null;
          setDismissed(true);
        }}
        aria-label="Cerrar aviso"
        style={{ background: "transparent", border: 0, color: "inherit", fontSize: "14px", fontWeight: 600, padding: "2px 4px", minHeight: "32px", cursor: "pointer" }}
      >
        Cerrar
      </button>
    </div>
  );
}
