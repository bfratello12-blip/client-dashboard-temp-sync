// app/api/googleads/select-account/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_KEYS = ["provider", "type", "source", "kind", "integration", "name"];
const GOOGLE_HINT_KEYS = ["google_ads_customer_id", "google_customer_id", "customer_id", "ad_account_id"];
const GOOGLE_TOKEN_KEYS = ["google_refresh_token", "refresh_token", "access_token"];

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;

const valueIncludes = (v: any, needle: string) => {
  if (v == null) return false;
  return String(v).toLowerCase().includes(needle);
};

function rowMatchesProvider(row: Record<string, any>, needles: string[]) {
  return PROVIDER_KEYS.some((key) => {
    if (!(key in row)) return false;
    return needles.some((n) => valueIncludes(row[key], n));
  });
}

function rowHasAnyKey(row: Record<string, any>, keys: string[]) {
  return keys.some((key) => key in row && hasNonEmpty(row[key]));
}

function pickKey(row: Record<string, any>, keys: string[], regexes: RegExp[]) {
  for (const key of keys) {
    if (key in row) return key;
  }

  const rowKeys = Object.keys(row);
  for (const r of regexes) {
    const match = rowKeys.find((k) => r.test(k));
    if (match) return match;
  }

  return null;
}

function pickValue(row: Record<string, any>, keys: string[], regexes: RegExp[]) {
  const key = pickKey(row, keys, regexes);
  return key ? row[key] : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const clientId = String(body?.client_id ?? "").trim();
    const googleAdsCustomerId = String(body?.google_ads_customer_id ?? "").trim();

    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!googleAdsCustomerId) {
      return NextResponse.json({ ok: false, error: "Missing google_ads_customer_id" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data: rows, error } = await supabase
      .from("client_integrations")
      .select("*")
      .eq("client_id", clientId)
      .limit(50);

    if (error) throw error;

    const integrations = (rows ?? []) as Record<string, any>[];
    const googleRows = integrations.filter(
      (row) => rowMatchesProvider(row, ["google"]) || rowHasAnyKey(row, GOOGLE_HINT_KEYS)
    );

    const googleRow =
      googleRows.find((row) => {
        const token = pickValue(row, GOOGLE_TOKEN_KEYS, [/google.*refresh.*token/i, /refresh.*token/i, /access.*token/i]);
        return hasNonEmpty(token);
      }) ?? googleRows[0];

    if (googleRow) {
      let update = supabase.from("client_integrations").update({ google_ads_customer_id: googleAdsCustomerId }).eq("client_id", clientId);
      if ("id" in googleRow) update = update.eq("id", googleRow.id);
      else if ("provider" in googleRow) update = update.eq("provider", googleRow.provider);
      else if ("type" in googleRow) update = update.eq("type", googleRow.type);
      else if ("source" in googleRow) update = update.eq("source", googleRow.source);
      else if ("kind" in googleRow) update = update.eq("kind", googleRow.kind);

      const { error: updErr } = await update;
      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, updated: true });
    }

    const insertPayload: Record<string, any> = {
      client_id: clientId,
      google_ads_customer_id: googleAdsCustomerId,
    };

    if (integrations.some((row) => "provider" in row)) insertPayload.provider = "google";
    if (integrations.some((row) => "is_active" in row)) insertPayload.is_active = true;

    const { error: insErr } = await supabase.from("client_integrations").insert(insertPayload);
    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, inserted: true });
  } catch (e: any) {
    console.error("googleads/select-account error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
