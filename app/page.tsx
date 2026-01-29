import { headers } from "next/headers";
import { redirect } from "next/navigation";
import HomeClient from "@/app/page.client";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromReferer(referer: string) {
  if (!referer) return "";
  const match = referer.match(/\/store\/([^/]+)/i);
  if (!match?.[1]) return "";
  return normalizeShopDomain(match[1]);
}

function getSingleParam(v?: string | string[]) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Home({ searchParams }: PageProps) {
  const hdrs = await headers();
  const referer = hdrs.get("referer") || "";
  const headerShop = normalizeShopDomain(hdrs.get("x-shopify-shop-domain") || "");
  const shopParamRaw = getSingleParam(searchParams?.shop) || "";
  const shopParam = normalizeShopDomain(shopParamRaw);
  const shopGuess = shopParam || headerShop || shopFromReferer(referer);

  console.info("[app-entry] HIT", {
    ts: new Date().toISOString(),
    shop: shopGuess || "",
    shopParam: shopParam || "",
    headerShop: headerShop || "",
    referer,
  });

  if (!shopGuess) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Missing shop domain</div>
      </main>
    );
  }

  const { data, error } = await supabaseAdmin()
    .from("shopify_app_installs")
    .select("access_token")
    .eq("shop_domain", shopGuess)
    .maybeSingle();

  if (error) {
    console.error("[app-entry] install lookup failed", {
      shop: shopGuess,
      message: error.message,
    });
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Unable to verify install</div>
      </main>
    );
  }

  if (!data?.access_token) {
    redirect(`/api/shopify/oauth/start?shop=${encodeURIComponent(shopGuess)}`);
  }

  return <HomeClient />;
}
