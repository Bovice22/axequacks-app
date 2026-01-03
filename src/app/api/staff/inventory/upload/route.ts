import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getStaffUserFromCookies } from "@/lib/staffAuth";

export async function POST(req: Request) {
  try {
    const staff = await getStaffUserFromCookies();
    if (!staff || staff.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "png";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const bucket = "inventory";

    const sb = supabaseServer();
    const { error: uploadErr } = await sb.storage.from(bucket).upload(filename, file, {
      upsert: true,
      contentType: file.type || "image/png",
    });
    if (uploadErr) {
      console.error("inventory image upload error:", uploadErr);
      return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }

    const { data } = sb.storage.from(bucket).getPublicUrl(filename);
    return NextResponse.json({ url: data.publicUrl }, { status: 200 });
  } catch (err: any) {
    console.error("inventory image upload fatal:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
