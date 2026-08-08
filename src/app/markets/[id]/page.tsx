import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarket } from "@/lib/data/markets";
import { getBook, getTape, getUserOpenOrders } from "@/lib/data/orders";
import { getUserById } from "@/lib/data/users";
import { getCurrentUser } from "@/lib/session";
import { formatPrice } from "@/lib/money";
import { QuoteForm } from "./QuoteForm";
import { SettleForm } from "./SettleForm";
import { CancelButton } from "./CancelButton";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const marketId = Number(id);
  if (!Number.isInteger(marketId)) {
    notFound();
  }

  const market = getMarket(marketId);
  if (!market) {
    notFound();
  }

  const creator = getUserById(market.creator_id);
  const book = getBook(marketId);
  const tape = getTape(marketId, 50);
  const user = await getCurrentUser();
  const userOrders = user ? getUserOpenOrders(marketId, user.id) : [];

  const typeLabel = market.type === "binary" ? "Yes/No" : "Numeric";
  const isOpen = market.status === "open";
  const isCreator = user !== null && user.id === market.creator_id;

  return (
    <div className="flex flex-col gap-10">
      {/* 1. Header */}
      <header className="flex flex-col gap-3 border-b border-black/10 pb-6 dark:border-white/15">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{market.title}</h1>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
            {typeLabel}
            {market.type === "numeric" && market.unit ? ` · ${market.unit}` : ""}
          </span>
          {isOpen ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Open
            </span>
          ) : null}
        </div>

        {market.description ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
            {market.description}
          </p>
        ) : null}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Created by {creator?.username ?? "unknown user"}
        </p>

        {!isOpen ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            Settled at {formatPrice(market.settle_c ?? 0, market.type)}
            {market.unit ? ` ${market.unit}` : ""}
          </div>
        ) : null}
      </header>

      {/* 2. Order book */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Order book</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Bids</h3>
            {book.bids.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No bids</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {book.bids.map((level) => (
                    <tr
                      key={level.priceC}
                      className="border-b border-black/5 dark:border-white/10"
                    >
                      <td className="py-1 font-medium text-emerald-700 dark:text-emerald-400">
                        {formatPrice(level.priceC, market.type)}
                      </td>
                      <td className="py-1 text-right text-zinc-600 dark:text-zinc-400">
                        {level.size}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Offers</h3>
            {book.offers.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No offers</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {book.offers.map((level) => (
                    <tr
                      key={level.priceC}
                      className="border-b border-black/5 dark:border-white/10"
                    >
                      <td className="py-1 font-medium text-red-700 dark:text-red-400">
                        {formatPrice(level.priceC, market.type)}
                      </td>
                      <td className="py-1 text-right text-zinc-600 dark:text-zinc-400">
                        {level.size}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* 3. Your open orders */}
      {user && userOrders.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your open orders</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                <th className="py-2 font-medium">Side</th>
                <th className="py-2 font-medium">Price</th>
                <th className="py-2 font-medium">Remaining</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {userOrders.map((order) => (
                <tr key={order.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2">{order.side === "buy" ? "Bid" : "Offer"}</td>
                  <td className="py-2">{formatPrice(order.price_c, market.type)}</td>
                  <td className="py-2">
                    {order.remaining} / {order.size}
                  </td>
                  <td className="py-2 text-right">
                    <CancelButton orderId={order.id} marketId={market.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* 4. Quote form */}
      {isOpen ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Trade</h2>
          {user ? (
            <QuoteForm marketId={market.id} marketType={market.type} unit={market.unit} />
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/markets/${market.id}`)}`}
              className="text-sm font-medium underline underline-offset-2"
            >
              Log in to trade
            </Link>
          )}
        </section>
      ) : null}

      {/* 5. Settle */}
      {isOpen ? (
        <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h2 className="text-lg font-semibold">Settle</h2>
          {isCreator ? (
            <SettleForm marketId={market.id} marketType={market.type} unit={market.unit} />
          ) : null}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The market creator settles this market.
          </p>
        </section>
      ) : null}

      {/* 6. Trade tape */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Trade tape</h2>
        {tape.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No trades yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {tape.map((trade) => (
              <li
                key={trade.id}
                className="flex flex-wrap justify-between gap-x-4 border-b border-black/5 py-1 dark:border-white/10"
              >
                <span>
                  {trade.buyerName} bought {trade.size} from {trade.sellerName} @{" "}
                  {formatPrice(trade.price_c, market.type)}
                </span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(trade.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AutoRefresh />
    </div>
  );
}
