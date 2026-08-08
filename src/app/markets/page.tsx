import Link from "next/link";
import { listMarkets, type MarketSummary } from "@/lib/data/markets";
import { formatPrice } from "@/lib/money";

export const dynamic = "force-dynamic";

function typeBadge(summary: MarketSummary): string {
  if (summary.market.type === "binary") return "yes/no";
  return summary.market.unit ?? "numeric";
}

function PriceCell({
  label,
  valueC,
  type,
}: {
  label: string;
  valueC: number | null;
  type: "binary" | "numeric";
}) {
  return (
    <div className="flex w-16 flex-col items-end">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium">
        {valueC === null ? "—" : formatPrice(valueC, type)}
      </span>
    </div>
  );
}

function OpenMarketRow({ summary }: { summary: MarketSummary }) {
  const { market, creatorName, bestBidC, bestOfferC, lastPriceC } = summary;
  return (
    <Link
      href={`/markets/${market.id}`}
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-black/10 px-4 py-3 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.05]"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{market.title}</span>
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
            {typeBadge(summary)}
          </span>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          by {creatorName}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <PriceCell label="Bid" valueC={bestBidC} type={market.type} />
        <PriceCell label="Offer" valueC={bestOfferC} type={market.type} />
        <PriceCell label="Last" valueC={lastPriceC} type={market.type} />
      </div>
    </Link>
  );
}

function SettledMarketRow({ summary }: { summary: MarketSummary }) {
  const { market, creatorName } = summary;
  return (
    <Link
      href={`/markets/${market.id}`}
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-black/10 px-4 py-3 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.05]"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{market.title}</span>
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
            {typeBadge(summary)}
          </span>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          by {creatorName}
        </span>
      </div>
      <span className="shrink-0 text-sm font-medium text-amber-700 dark:text-amber-400">
        Settled at {formatPrice(market.settle_c ?? 0, market.type)}
        {market.unit ? ` ${market.unit}` : ""}
      </span>
    </Link>
  );
}

export default function MarketsPage() {
  const { open, settled } = listMarkets();
  const isEmpty = open.length === 0 && settled.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Markets</h1>
        <Link
          href="/markets/new"
          className="shrink-0 rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          New market
        </Link>
      </div>

      {isEmpty ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No markets yet — create the first one.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Open</h2>
            {open.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No open markets.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {open.map((summary) => (
                  <OpenMarketRow key={summary.market.id} summary={summary} />
                ))}
              </div>
            )}
          </section>

          {settled.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Settled</h2>
              <div className="flex flex-col gap-2">
                {settled.map((summary) => (
                  <SettledMarketRow key={summary.market.id} summary={summary} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
