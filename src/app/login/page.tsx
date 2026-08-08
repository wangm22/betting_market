import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/markets");

  const { next } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8 shadow-sm dark:border-white/15">
        <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
        <LoginForm next={next} />
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No account?{" "}
          <Link href="/register" className="font-medium underline underline-offset-2">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
