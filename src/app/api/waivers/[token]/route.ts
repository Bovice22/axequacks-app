import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const WAIVER_TEXT = [
  "Release of Liability & Audio/Visual Consent",
  "THIS DOCUMENT IS A LEGAL RELEASE THAT AFFECTS YOUR RIGHTS. READ BEFORE SIGNING.",
  "",
  "I wish to gain access to 139 S. Main St, Bellefontaine, OH 43311 to observe and/or participate in axe throwing activities offered by Axe Quacks, LLC. In consideration for the opportunity to do so, I hereby execute this Waiver and Release of Liability (this \"Agreement”). For purposes of this Agreement, the term “Company” shall refer to Axe Quacks, LLC and its owners, agents, employees, volunteers, coaches, insurers, and any and all other persons or entities acting on their behalf. The term “Location” shall refer to:",
  "139 S. Main St, Bellefontaine OH 43311.",
  "",
  "I acknowledge that axe throwing games, activities, the consumption of alcohol, and any related services and activities (the “Activities”), as well as my physical presence at the Location, are inherently dangerous in nature and entail known and unknown risks that could result in serious and permanent injury to me or my property, including: physical injury, including but not limited to broken bones, sprained or torn ligaments, and the like, emotional injury, disfigurement, paralysis, or even death (the “Risks’). I understand that, due to the nature of the Activities, such Risks cannot be completely eliminated. I understand and voluntarily assume all Risks relating to the Activities and my presence at the Location, and elect to be present and participate despite these risks.",
  "",
  "I acknowledge that I have read the rules provided by the Company concerning the Activities (the \"Company Rules\"), which govern my participation in the Activities. I further acknowledge that I may receive coaching and instruction from Company staff relating to the Activities (\"Coaching’). I acknowledge that my failure to act in compliance with the Company Rules or Coaching may result in my expulsion from the location and the exclusion from the Activities. | acknowledge that even if acting in conformance with the Company Rules and Coaching, the Risks will not be eliminated and that my participation in the Activities and presence at the Location still subjects me to the Risks.",
  "",
  "I certify that I am in good physical health do not suffer from any physical, psychological, or emotional conditions that would place me or other participants in jeopardy.",
  "",
  "In exchange for the opportunity to enter the Location and participate in the Activities, | hereby release the Company from — any and all claims, demands, causes of action, losses, damages, liabilities, judgments, settlements, costs, or expenses of any kind, whether currently known or unknown, that at any time may arise out of or relate in any way to (a) my presence at the Location, (b) my participation in the Activities, and/or (c) the form or content of the Company Rules or Coaching (the “Claims”), including any such Claims relating to or alleging negligent acts or omissions of the Company. I the undersigned on behalf of myself, my spouse, children, parents, heirs, assigns, personal representatives, estate and insurers, expressly and explicitly waive any current or future rights to pursue such Claims, and covenant not to sue the such Claims.",
  "",
  "If the Company incurs attorney fees and costs to enforce this Agreement or defending any Claims, I agree to indemnify and hold the Company harmless for all reasonable attorney fees and costs.",
  "",
  "I further grant the Company the right, without reservation or limitation, to photograph, video record, monitor me on closed circuit television at the Location. I further grant the Company the right, without limitation, to use such photographs, video recordings, or audio recordings, and any edited or altered versions of the (\"Materials”), in connection with or relating to the Company's business, including in: staff training, quality control processes, publicity, advertising, promotional use, and any other use of any kind. I acknowledge I have no right to review or approve of any of the Materials before the Company's Uses, and that the Company shall have no liability or obligation of any kind to me relating to the Materials or Uses. The Company may use the Materials for the Uses into perpetuity without any obligation or compensation to me of any kind.",
  "",
  "This Agreement shall be governed by and construed in accordance with the laws of the State of Ohio. If any provision of this Agreement is held to be illegal, unenforceable, or invalid, that provision will be limited or eliminated to the minimum extent necessary so that this Agreement will otherwise remain in full force and effect.",
  "",
  "In the event of any dispute arising from or relating in any way to this Agreement, my participation in the Activities, my presence at the Location, the Claims, the Materials, or Uses of the Materials (\"Dispute\"), any such Dispute will be subject to binding arbitration before one arbitrator in Findlay, Ohio. The arbitration will be administered by JAMS pursuant to its Streamlined Arbitration Rules and Procedures. If JAMS is not available, the arbitration will be administered by the American Arbitration Association pursuant to its commercial arbitration rules. In any such arbitration, the arbitrator will be a person(s) selected by the parties if they are able to so agree within ten days after any party requests the other party to so agree. Otherwise, the selection will be made pursuant to the rules of the applicable arbitration association The decision of the arbitrator will be final conclusively determinative of any Dispute, will be non-appealable and the award of the arbitrator may be entered as a final judgment in any court of record in the United States or elsewhere. Any Dispute, including the determination of the scope or applicability, will, except to the narrowest extent or applicability of this agreement to arbitrate prohibited by law, be determined by such arbitration in accordance with the law of Ohio without respect to conflict of law principles.",
  "",
  "| agree that by allowing me to participate in the Activities and granting me permission to enter the Location, the Company has provided adequate consideration for this Agreement. I understand and agree this release shall cover each and every instance of my participation in the Activities and my presence in the Location after signing this Agreement. This is a complete agreement. No oral promises or representations were made to me concerning this document or its terms.",
  "By signing here, you are consenting to the use of your electronic signature in lieu of an original signature on paper. You have the right to request that you sign a paper copy instead. By checking here, you are waiving that right. After consent, you may, upon written request to us, obtain a paper copy of an electronic record. No fee will be charged for such copy and no special hardware or software is required to view it. Your agreement to use an electronic signature with us for any documents will continue until such time as you notify us in writing that you no longer wish to use an electronic signature. There is no penalty for withdrawing your consent. You should always make sure that we have a current email address in order to contact you regarding any changes, if necessary.",
  "",
  "I HAVE READ THIS RELEASE AND UNDERSTAND AND AGREE TO ITS TERMS ON MY OWN BEHALF AND THAT OF MY HEIRS, SUCCESSORS, AND ASSIGNS, AND THAT VOLUNTARILY GIVING UP SUBSTANTIAL LEGAL RIGHTS, INCLUDING THE RIGHT TO SUE THE COMPANY",
].join("\n\n");

function resolveToken(req: Request, context: { params: { token: string } }) {
  const fromParams = String(context?.params?.token || "").trim();
  if (fromParams) return fromParams;
  try {
    const url = new URL(req.url);
    const fromQuery = String(url.searchParams.get("token") || "").trim();
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    return String(parts[parts.length - 1] || "").trim();
  } catch {
    return "";
  }
}

export async function GET(req: Request, context: { params: { token: string } }) {
  try {
    const token = resolveToken(req, context);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const sb = supabaseServer();
    const { data, error } = await sb
      .from("waiver_requests")
      .select("id,customer_id,booking_id,status,token,created_at,customers(full_name,email)")
      .eq("token", token)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Waiver not found" }, { status: 404 });
    }

    let signed: any = null;
    if (data.status === "SIGNED") {
      const { data: waiverRow } = await sb
        .from("customer_waivers")
        .select("signer_name,signer_email,signature_text,signed_at")
        .eq("customer_id", data.customer_id)
        .eq("booking_id", data.booking_id)
        .order("signed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (waiverRow) {
        signed = waiverRow;
      }
    }

    return NextResponse.json(
      {
        status: data.status,
        customer: {
          full_name: (data as any)?.customers?.full_name || "",
          email: (data as any)?.customers?.email || "",
        },
        waiverText: WAIVER_TEXT,
        signed,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, context: { params: { token: string } }) {
  try {
    const token = resolveToken(req, context);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const signerName = String(body?.name || "").trim();
    const signerEmail = String(body?.email || "").trim();
    const signatureText = String(body?.signature || signerName).trim();

    if (!signerName || !signatureText) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: request, error: reqErr } = await sb
      .from("waiver_requests")
      .select("id,customer_id,booking_id,status")
      .eq("token", token)
      .single();

    if (reqErr || !request) {
      return NextResponse.json({ error: "Waiver not found" }, { status: 404 });
    }

    if (request.status === "SIGNED") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const { error: waiverErr } = await sb.from("customer_waivers").insert({
      customer_id: request.customer_id,
      booking_id: request.booking_id,
      signer_name: signerName,
      signer_email: signerEmail || null,
      signature_text: signatureText,
      signed_at: new Date().toISOString(),
    });

    if (waiverErr) {
      return NextResponse.json({ error: waiverErr.message || "Failed to save waiver" }, { status: 500 });
    }

    await sb
      .from("waiver_requests")
      .update({ status: "SIGNED", signed_at: new Date().toISOString() })
      .eq("id", request.id);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
