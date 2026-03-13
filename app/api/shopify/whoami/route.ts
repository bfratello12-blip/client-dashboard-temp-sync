import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

export async function GET(req: NextRequest) {
  try {
    const shop = normalizeShopDomain(req.nextUrl.searchParams.get("shop") || "");
    if (!shop) {
      const error = "missing shop parameter";
      console.error("[whoami] error", { error });
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("shopify_app_installs")
      .select("client_id, shop_domain")
      .eq("shop_domain", shop)
      .limit(1)
      .maybeSingle();

    if (error || !data?.client_id || !data?.shop_domain) {
      console.error("[whoami] error", {
        error: error?.message || "client not found for shop",
        shop,
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const resolvedShop = normalizeShopDomain(String(data.shop_domain));
    console.info("[whoami] ok", { shop: resolvedShop, client_id: data.client_id });
    const res = NextResponse.json({
      ok: true,
      client_id: String(data.client_id),
      shop_domain: resolvedShop,
      shop: resolvedShop,
    });
    res.cookies.set("sa_shop", resolvedShop, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 86400,
    });
    return res;
  } catch (error) {
    console.error("[whoami] error", { error });
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}
