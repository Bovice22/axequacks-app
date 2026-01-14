import { cookies, headers } from "next/headers";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export default async function StaffDiagnosticsPage() {
  const cookieStore = await cookies();
  const staff = await getStaffUserFromCookies();
  const host = (await headers()).get("host") || "unknown";
  const accessToken = cookieStore.get("staff_access_token")?.value;
  const refreshToken = cookieStore.get("staff_refresh_token")?.value;

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-extrabold text-zinc-900">Staff Diagnostics</h1>
        <p className="mt-1 text-sm text-zinc-600">
          This page shows whether the server can see your staff cookies.
        </p>

        <div className="mt-6 space-y-3 text-sm text-zinc-800">
          <div>
            <span className="font-semibold">Host:</span> {host}
          </div>
          <div>
            <span className="font-semibold">Has access token:</span> {accessToken ? "yes" : "no"}
          </div>
          <div>
            <span className="font-semibold">Has refresh token:</span> {refreshToken ? "yes" : "no"}
          </div>
          <div>
            <span className="font-semibold">Staff lookup:</span>{" "}
            {staff ? `${staff.staff_id} (${staff.role})` : "not found"}
          </div>
        </div>

        <div className="mt-6 text-xs text-zinc-500">
          If tokens are "no" after a login attempt, the login cookie is not being stored.
        </div>
      </div>
    </div>
  );
}
