import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelButton } from "@/app/markets/[id]/CancelButton";
import { getUserOpenOrdersAcrossMarkets } from "@/lib/data/orders";
import { getUserPortfolio } from "@/lib/data/pnl";
import { getUserByUsername } from "@/lib/data/users";
import { formatC, formatPrice } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function pnlColorClass(pnlC: number): string {
  if (pnlC > 0) return "text-emerald-700 dark:text-emerald-400";
  if (pnlC < 0) return "text-red-700 dark:text-red-400";
  return "text-zinc-500 dark:text-zinc-400";
}

function SignedPnl({ pnlC }: { pnlC: number }) {
  const sign = pnlC > 0 ? "+" : "";
  return (
    <span className={`font-medium ${pnlColorClass(pnlC)}`}>
      {sign}
      {formatC(pnlC)}
    </span>
  );
}

export default async function UserPortfolioPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username: rawUsername } = await params;

  let username: string | null;
  try {
    username = decodeURIComponent(rawUsername);
  } catch {
    username = null;
  }
  if (username === null) {
    notFound();
  }

  const user = getUserByUsername(username);
  if (!user) {
    notFound();
  }

  const viewer = await getCurrentUser();
  const isOwner = viewer !== null && viewer.id === user.id;
  const openOrders = isOwner ? getUserOpenOrdersAcrossMarkets(user.id) : [];

  const { open, realized, totalPnlC } = getUserPortfolio(user.id);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 border-b border-black/10 pb-6 dark:border-white/15">
        <h1 className="text-2xl font-semibold">{user.username}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cumulative PnL: <SignedPnl pnlC={totalPnlC} />
        </p>
      </header>

      {isOwner ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Open orders</h2>
          {openOrders.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No working orders.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                  <th className="py-2 font-medium">Market</th>
                  <th className="py-2 font-medium">Side</th>
                  <th className="py-2 font-medium">Price</th>
                  <th className="py-2 font-medium">Remaining</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {openOrders.map((view) => (
                  <tr
                    key={view.order.id}
                    className="border-b border-black/5 dark:border-white/10"
                  >
                    <td className="py-2">
                      <Link
                        href={`/markets/${view.marketId}`}
                        className="font-medium hover:underline"
                      >
                        {view.title}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          view.order.side === "buy"
                            ? "font-medium text-emerald-700 dark:text-emerald-400"
                            : "font-medium text-red-700 dark:text-red-400"
                        }
                      >
                        {view.order.side === "buy" ? "Bid" : "Offer"}
                      </span>
                    </td>
                    <td className="py-2">
                      {formatPrice(view.order.price_c, view.type)}
                      {view.unit ? ` ${view.unit}` : ""}
                    </td>
                    <td className="py-2">
                      {view.order.remaining} of {view.order.size}
                    </td>
                    <td className="py-2 text-right">
                      <CancelButton orderId={view.order.id} marketId={view.marketId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Open positions</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Positions appear once one of your quotes trades.
        </p>
        {open.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No open positions.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                <th className="py-2 font-medium">Market</th>
                <th className="py-2 font-medium">Position</th>
                <th className="py-2 font-medium text-right">Avg price</th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => (
                <tr
                  key={position.marketId}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2">
                    <Link
                      href={`/markets/${position.marketId}`}
                      className="font-medium hover:underline"
                    >
                      {position.title}
                    </Link>
                  </td>
                  <td className="py-2">
                    <span
                      className={
                        position.netSize > 0
                          ? "font-medium text-emerald-700 dark:text-emerald-400"
                          : "font-medium text-red-700 dark:text-red-400"
                      }
                    >
                      {position.netSize > 0 ? "Long" : "Short"}{" "}
                      {Math.abs(position.netSize)}
                    </span>
                  </td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {formatPrice(position.avgPriceC, position.type)}
                    {position.unit ? ` ${position.unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Realized PnL</h2>
        {realized.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing settled yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                <th className="py-2 font-medium">Market</th>
                <th className="py-2 font-medium">Settled at</th>
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {realized.map((r) => (
                <tr
                  key={r.marketId}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2">
                    <Link
                      href={`/markets/${r.marketId}`}
                      className="font-medium hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">
                    {formatPrice(r.settleC, r.type)}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className="py-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(r.settledAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-right">
                    <SignedPnl pnlC={r.pnlC} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
