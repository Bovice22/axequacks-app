import { NextResponse } from "next/server";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function GET() {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    return NextResponse.json(
      {
        id: staff.id,
        staff_id: staff.staff_id,
        role: staff.role,
        full_name: staff.full_name,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
