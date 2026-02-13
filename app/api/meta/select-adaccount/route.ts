// app/api/meta/select-adaccount/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeMetaAdAccountId } from "@/lib/meta/adAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hasKey = (row: Record<string, any> | null, key: string) => row && key in row;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const clientId = String(body?.client_id ?? "").trim();
    const metaAdAccountId = normalizeMetaAdAccountId(String(body?.meta_ad_account_id ?? "").trim());
    const metaAdAccountName = String(body?.meta_ad_account_name ?? "").trim();

    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!metaAdAccountId) {
      return NextResponse.json({ ok: false, error: "Missing meta_ad_account_id" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data: rows, error } = await supabase
      .from("client_integrations")
      .select("*")
      .eq("client_id", clientId)
      .eq("provider", "meta")
      .limit(1);

    if (error) throw error;

    const row = (rows?.[0] as Record<string, any> | undefined) ?? null;

    if (row) {
      const update: Record<string, any> = {
        status: "connected",
        is_active: true,
        meta_ad_account_id: metaAdAccountId,
      };
      if (metaAdAccountName && hasKey(row, "meta_ad_account_name")) {
        update.meta_ad_account_name = metaAdAccountName;
      }

      const { error: updErr } = await supabase
        .from("client_integrations")
        .update(update)
        .eq("client_id", clientId)
        .eq("provider", "meta");

      if (updErr) throw updErr;
    } else {
      const baseInsert: Record<string, any> = {
        client_id: clientId,
        provider: "meta",
        status: "connected",
        is_active: true,
        meta_ad_account_id: metaAdAccountId,
      };

      if (metaAdAccountName) {
        const { error: insErr } = await supabase.from("client_integrations").insert({
          ...baseInsert,
          meta_ad_account_name: metaAdAccountName,
        });
        if (insErr) {
          const { error: retryErr } = await supabase.from("client_integrations").insert(baseInsert);
          if (retryErr) throw retryErr;
        }
      } else {
        const { error: insErr } = await supabase.from("client_integrations").insert(baseInsert);
        if (insErr) throw insErr;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("meta/select-adaccount error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
