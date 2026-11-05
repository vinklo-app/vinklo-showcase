"use client";

import * as React from "react";
import { confirmBizum } from "@/lib/actions/contributions-panel";
import { Button } from "@/components/ui/button";

/**
 * Confirmación en un toque de un Bizum manual pendiente.
 * La revalidación del panel la hace la server action.
 */
export function ConfirmBizumButton({
  contributionId,
}: {
  contributionId: string;
}) {
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await confirmBizum(contributionId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        onClick={confirm}
        disabled={isPending}
        className="bg-[var(--salvia)] text-[var(--papel)] hover:bg-[var(--salvia)]/90"
      >
        {isPending ? "Confirmando…" : "Confirmar"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-[var(--granate)]">
          {error}
        </span>
      )}
    </span>
  );
}
