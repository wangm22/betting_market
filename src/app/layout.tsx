import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/app/actions";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Betting Market",
  description: "Play-money order-book trading game",
};

const navLinkClass =
  "text-sm text-zinc-600 hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="border-b border-black/10 dark:border-white/15">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="font-semibold">
                Betting Market
              </Link>
              <Link href="/markets" className={navLinkClass}>
                Markets
              </Link>
              <Link href="/leaderboard" className={navLinkClass}>
                Leaderboard
              </Link>
            </div>

            <div className="flex items-center gap-4">
              {user ? (
                <>
                  <Link href={`/users/${encodeURIComponent(user.username)}`} className={navLinkClass}>
                    Portfolio
                  </Link>
                  <span className="rounded-full bg-black/5 px-3 py-1 text-sm dark:bg-white/10">
                    {user.username}
                  </span>
                  <form action={logoutAction}>
                    <button type="submit" className={navLinkClass}>
                      Log out
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className={navLinkClass}>
                    Log in
                  </Link>
                  <Link href="/register" className={navLinkClass}>
                    Register
                  </Link>
                </>
              )}
            </div>
          </div>
        </nav>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
