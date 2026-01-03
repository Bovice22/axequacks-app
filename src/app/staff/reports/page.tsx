import { requireAdmin } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";
import ReportsDashboard from "./ReportsDashboard";

export default async function ReportsPage() {
  await requireAdmin();

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full">
          <h1 className="text-xl font-bold">Reporting</h1>
          <StaffNav />
        </div>

        <form action="/staff/logout" method="post">
          <button className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm">Log out</button>
        </form>
      </div>

      <div className="mt-4">
        <ReportsDashboard />
      </div>
    </div>
  );
}
