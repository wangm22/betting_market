import { requireUserOrRedirect } from "@/lib/session";
import { NewMarketForm } from "./NewMarketForm";

export const dynamic = "force-dynamic";

export default async function NewMarketPage() {
  await requireUserOrRedirect("/markets/new");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">New market</h1>
      <NewMarketForm />
    </div>
  );
}
