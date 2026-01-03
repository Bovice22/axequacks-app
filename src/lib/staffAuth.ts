import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

type StaffUser = {
  id: string;
  staff_id: string;
  role: "staff" | "admin";
  full_name: string | null;
  active: boolean;
};

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anonKey, { auth: { persistSession: false } });
}

export async function getStaffUserFromCookies(): Promise<StaffUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("staff_access_token")?.value;
  if (!accessToken) return null;

  const sb = anonClient();
  const { data: authData, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !authData.user) return null;

  const admin = supabaseServer();
  const { data: staff } = await admin
    .from("staff_users")
    .select("id,staff_id,role,full_name,active")
    .eq("auth_user_id", authData.user.id)
    .single();

  if (!staff || !staff.active) return null;
  return staff as StaffUser;
}

export async function requireStaff(): Promise<StaffUser> {
  const staff = await getStaffUserFromCookies();
  if (!staff) redirect("/staff/login");
  return staff;
}

export async function requireAdmin(): Promise<StaffUser> {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/staff/bookings");
  return staff;
}
