"use client";

import { useActionState } from "react";
import { cancelOrderAction, type ActionState } from "@/app/actions";

export function CancelButton({
  orderId,
  marketId,
}: {
  orderId: number;
  marketId: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    cancelOrderAction,
    {},
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="marketId" value={marketId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {state?.error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>
      ) : null}
    </form>
  );
}
