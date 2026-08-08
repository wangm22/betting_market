"use client";

import { useActionState, useState } from "react";
import { createMarketAction, type ActionState } from "@/app/actions";

export function NewMarketForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createMarketAction,
    {},
  );
  const [type, setType] = useState<"binary" | "numeric">("binary");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Type</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="type"
              value="binary"
              checked={type === "binary"}
              onChange={() => setType("binary")}
            />
            Binary (yes/no)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="type"
              value="numeric"
              checked={type === "numeric"}
              onChange={() => setType("numeric")}
            />
            Numeric
          </label>
        </div>
      </div>

      {type === "numeric" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="unit" className="text-sm font-medium">
            Unit (optional, e.g. min)
          </label>
          <input
            id="unit"
            name="unit"
            type="text"
            maxLength={20}
            className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
          />
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded bg-black px-4 py-2 font-medium text-white transition-opacity disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Creating…" : "Create market"}
      </button>
    </form>
  );
}
