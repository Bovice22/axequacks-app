import { requireStaff } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";
import PosScreen from "./PosScreen";

export default async function PosPage() {
  await requireStaff();

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full">
          <h1 className="text-xl font-bold">POS</h1>
          <StaffNav />
        </div>

        <form action="/staff/logout" method="post">
          <button className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
            Log out
          </button>
        </form>
      </div>

      <div className="mt-4">
        <PosScreen />
      </div>
    </div>
  );
}
