import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const defaultClientId = String(process.env.DEFAULT_CLIENT_ID || "").trim();
    if (!defaultClientId) {
      return NextResponse.json({ ok: false, error: "DEFAULT_CLIENT_ID not configured" }, { status: 404 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("clients")
      .select("id, name")
      .eq("id", defaultClientId)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      client: {
        id: defaultClientId,
        name: String(data?.name || "Project Default Client"),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
