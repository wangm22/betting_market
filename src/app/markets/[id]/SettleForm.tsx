"use client";

import { useActionState } from "react";
import { settleMarketAction, type ActionState } from "@/app/actions";
import type { MarketType } from "@/lib/types";

export function SettleForm({
  marketId,
  marketType,
  unit,
}: {
  marketId: number;
  marketType: MarketType;
  unit: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    settleMarketAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="marketId" value={marketId} />

      {marketType === "binary" ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="outcome"
            value="yes"
            disabled={pending}
            onClick={(e) => {
              if (
                !window.confirm(
                  "Settle this market as YES (10)? This cannot be undone.",
                )
              ) {
                e.preventDefault();
              }
            }}
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white transition-opacity hover:bg-emerald-700 disabled:opacity-50"
          >
            Settle YES (10)
          </button>
          <button
            type="submit"
            name="outcome"
            value="no"
            disabled={pending}
            onClick={(e) => {
              if (
                !window.confirm(
                  "Settle this market as NO (0)? This cannot be undone.",
                )
              ) {
                e.preventDefault();
              }
            }}
            className="rounded bg-red-600 px-4 py-2 font-medium text-white transition-opacity hover:bg-red-700 disabled:opacity-50"
          >
            Settle NO (0)
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="value" className="text-xs text-zinc-500 dark:text-zinc-400">
              Settle value{unit ? ` (${unit})` : ""}
            </label>
            <input
              id="value"
              name="value"
              type="number"
              step="0.01"
              required
              className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            onClick={(e) => {
              if (
                !window.confirm(
                  "Settle this market with this value? This cannot be undone.",
                )
              ) {
                e.preventDefault();
              }
            }}
            className="rounded bg-black px-4 py-2 font-medium text-white transition-opacity disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Settle
          </button>
        </div>
      )}

      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      {state?.message ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</p>
      ) : null}
    </form>
  );
}
