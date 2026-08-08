"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitQuoteAction, type ActionState } from "@/app/actions";
import type { MarketType } from "@/lib/types";

export function QuoteForm({
  marketId,
  marketType,
  unit,
}: {
  marketId: number;
  marketType: MarketType;
  unit: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    submitQuoteAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  // `state` is a fresh object every time the action resolves (including the
  // initial mount), so this effect fires exactly once per result — reset the
  // (uncontrolled) price/size fields whenever a submission actually went
  // through.
  useEffect(() => {
    if (state?.message) {
      formRef.current?.reset();
    }
  }, [state]);

  const priceHelp =
    marketType === "binary" ? "probability 1–99" : `price in ${unit ? unit : "units"}`;
  // pattern only fires on non-empty fields, so leaving a whole leg blank stays valid.
  const pricePattern =
    marketType === "binary" ? "[1-9][0-9]?" : "-?[0-9]{1,7}([.][0-9]{1,2})?";
  const priceTitle =
    marketType === "binary" ? "Whole number 1–99" : "Number with up to 2 decimals";
  const sizePattern = "[1-9][0-9]{0,4}";
  const sizeTitle = "Whole number 1–10,000";

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="marketId" value={marketId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/15">
          <legend className="px-1 text-sm font-medium">Bid (buy)</legend>
          <div className="flex flex-col gap-1">
            <label htmlFor="bidPrice" className="text-xs text-zinc-500 dark:text-zinc-400">
              Price ({priceHelp})
            </label>
            <input
              id="bidPrice"
              name="bidPrice"
              type="text"
              inputMode="decimal"
              pattern={pricePattern}
              title={priceTitle}
              placeholder={marketType === "binary" ? "e.g. 60" : "e.g. 27.50"}
              className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bidSize" className="text-xs text-zinc-500 dark:text-zinc-400">
              Size (1–10,000)
            </label>
            <input
              id="bidSize"
              name="bidSize"
              type="text"
              inputMode="numeric"
              pattern={sizePattern}
              title={sizeTitle}
              maxLength={5}
              placeholder="e.g. 10"
              className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/15">
          <legend className="px-1 text-sm font-medium">Offer (sell)</legend>
          <div className="flex flex-col gap-1">
            <label htmlFor="offerPrice" className="text-xs text-zinc-500 dark:text-zinc-400">
              Price ({priceHelp})
            </label>
            <input
              id="offerPrice"
              name="offerPrice"
              type="text"
              inputMode="decimal"
              pattern={pricePattern}
              title={priceTitle}
              placeholder={marketType === "binary" ? "e.g. 65" : "e.g. 30.00"}
              className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="offerSize" className="text-xs text-zinc-500 dark:text-zinc-400">
              Size (1–10,000)
            </label>
            <input
              id="offerSize"
              name="offerSize"
              type="text"
              inputMode="numeric"
              pattern={sizePattern}
              title={sizeTitle}
              maxLength={5}
              placeholder="e.g. 10"
              className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
          </div>
        </fieldset>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Submitting a bid at or above the best offer (or an offer at or below the best bid)
        trades immediately at the resting price.
      </p>

      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      {state?.message ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-black px-4 py-2 font-medium text-white transition-opacity disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Submitting…" : "Submit quote"}
      </button>
    </form>
  );
}
