import { requireStaff } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";
import TimeClockPanel from "./time-clock-panel";

export default async function StaffTimeClockPage() {
  await requireStaff();

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full">
          <h1 className="text-xl font-bold">Time Clock</h1>
          <StaffNav />
        </div>

        <form action="/staff/logout" method="post">
          <button className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 sm:w-auto">
            Log out
          </button>
        </form>
      </div>

      <div className="mt-4">
        <TimeClockPanel />
      </div>
    </div>
  );
}
