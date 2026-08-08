import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/markets");

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8 shadow-sm dark:border-white/15">
        <h1 className="mb-6 text-2xl font-semibold">Register</h1>
        <RegisterForm />
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Have an account?{" "}
          <Link href="/login" className="font-medium underline underline-offset-2">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
