import { redirect } from "next/navigation";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export default async function StaffPage() {
  const staff = await getStaffUserFromCookies();
  if (!staff) redirect("/staff/login");
  redirect("/staff/bookings");
}
