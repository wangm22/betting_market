import Link from "next/link";
import { getLeaderboard } from "@/lib/data/pnl";
import { formatC } from "@/lib/money";

export const dynamic = "force-dynamic";

function PnlValue({ pnlC }: { pnlC: number }) {
  const colorClass =
    pnlC > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : pnlC < 0
        ? "text-red-700 dark:text-red-400"
        : "text-zinc-500 dark:text-zinc-400";
  const sign = pnlC > 0 ? "+" : "";
  return (
    <span className={`font-medium ${colorClass}`}>
      {sign}
      {formatC(pnlC)}
    </span>
  );
}

export default function LeaderboardPage() {
  const entries = getLeaderboard();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Leaderboard</h1>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No traders yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                <th className="py-2 font-medium">Rank</th>
                <th className="py-2 font-medium">Trader</th>
                <th className="py-2 font-medium text-right">PnL</th>
                <th className="py-2 font-medium text-right">
                  Settled markets traded
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr
                  key={entry.userId}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">
                    {index + 1}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/users/${encodeURIComponent(entry.username)}`}
                      className="font-medium hover:underline"
                    >
                      {entry.username}
                    </Link>
                  </td>
                  <td className="py-2 text-right">
                    <PnlValue pnlC={entry.pnlC} />
                  </td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {entry.marketsTraded}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            PnL is cumulative across settled markets, in points.
          </p>
        </>
      )}
    </div>
  );
}
