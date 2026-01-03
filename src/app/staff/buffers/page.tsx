import { requireAdmin } from "@/lib/staffAuth";
import BuffersTable from "./BuffersTable";
import BlackoutsTable from "../blackouts/BlackoutsTable";
import PoliciesForm from "../policies/PoliciesForm";
import StaffNav from "@/components/StaffNav";

export default async function BuffersPage() {
  await requireAdmin();

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full">
          <h1 className="text-xl font-bold">Buffers/Blackouts/Policies</h1>
          <StaffNav />
        </div>

        <form action="/staff/logout" method="post">
          <button className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm">Log out</button>
        </form>
      </div>

      <div className="mt-4">
        <div className="space-y-6">
          <PoliciesForm />
          <BuffersTable />
          <BlackoutsTable />
        </div>
      </div>
    </div>
  );
}
