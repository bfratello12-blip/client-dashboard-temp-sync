import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, jwtVerify } from "jose";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromDest(dest?: string) {
  if (!dest) return "";
  try {
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

async function shopFromSessionToken(token: string): Promise<string> {
  const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET || "";
  let payload: { dest?: string } | null = null;

  if (secret) {
    try {
      const { payload: verified } = await jwtVerify(
        token,
        new TextEncoder().encode(secret)
      );
      payload = verified as { dest?: string };
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = decodeJwt(token) as { dest?: string };
    } catch {
      payload = null;
    }
  }

  return shopFromDest(payload?.dest || "");
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();
    const limitRaw = (searchParams.get("limit") || "").trim();
    const limit = Math.max(1, Math.min(500, Number(limitRaw || 100) || 100));

    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing start/end" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1] || "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const shop = await shopFromSessionToken(token);
    if (!shop) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = supabaseAdmin();
    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id")
      .eq("shop_domain", shop)
      .maybeSingle();

    if (installErr || !install?.client_id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("get_product_performance", {
      p_client_id: install.client_id,
      p_start: start,
      p_end: end,
      p_limit: limit,
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
