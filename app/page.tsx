import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import HomeClient from "@/app/page.client";
import ShopifyBootstrap from "@/app/components/ShopifyBootstrap";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded =
    pad === 0
      ? normalized
      : pad === 2
      ? `${normalized}==`
      : pad === 3
      ? `${normalized}=`
      : `${normalized}===`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function shopFromIdToken(idToken: string) {
  try {
    const payloadSegment = idToken.split(".")[1] || "";
    if (!payloadSegment) return "";
    const payloadJson = base64UrlDecode(payloadSegment);
    const payload = JSON.parse(payloadJson) as { dest?: string };
    const dest = payload?.dest || "";
    if (!dest) return "";
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const hdrs = await headers();
  const referer = hdrs.get("referer") || "";
  const url = hdrs.get("x-url") || "";
  const headerShop = normalizeShopDomain(hdrs.get("x-shopify-shop-domain") || "");
  const shopParamRaw = sp?.shop;
  const shopParam =
    typeof shopParamRaw === "string"
      ? shopParamRaw
      : Array.isArray(shopParamRaw)
      ? shopParamRaw[0]
      : "";
  const cookieStore = await cookies();
  const cookieShopRaw = !shopParam ? cookieStore.get("sa_shop")?.value || "" : "";
  const cookieShop = normalizeShopDomain(cookieShopRaw);
  const hostParamRaw = sp?.host;
  const hostParam =
    typeof hostParamRaw === "string"
      ? hostParamRaw
      : Array.isArray(hostParamRaw)
      ? hostParamRaw[0]
      : "";
  const idTokenRaw = sp?.id_token;
  const idToken =
    typeof idTokenRaw === "string"
      ? idTokenRaw
      : Array.isArray(idTokenRaw)
      ? idTokenRaw[0]
      : "";
  const clientIdParamRaw = sp?.client_id;
  const clientIdParam =
    typeof clientIdParamRaw === "string"
      ? clientIdParamRaw
      : Array.isArray(clientIdParamRaw)
      ? clientIdParamRaw[0]
      : "";
  const shopFromToken = idToken ? shopFromIdToken(idToken) : "";
  const refererShop = shopFromReferer(referer);
  const shopGuess = normalizeShopDomain(
    shopParam || shopFromToken || headerShop || refererShop || cookieShop
  );
  const hasShopifyContext = Boolean(
    shopParam || hostParam || idToken || headerShop || refererShop || cookieShop
  );
  const shopSource = shopParam
    ? "shop_param"
    : shopFromToken
    ? "id_token"
    : headerShop
    ? "header"
    : refererShop
    ? "referer"
    : cookieShop
    ? "cookie"
    : "missing";

  console.info("[app-entry] HIT", {
    ts: new Date().toISOString(),
    url,
    shop: shopGuess || "",
    shopSource,
    hasShopParam: Boolean(shopParam),
    hasIdToken: Boolean(idToken),
    headerShop: headerShop || "",
    referer,
  });

  const isDev = process.env.NODE_ENV === "development";
  const devClientId = clientIdParam || process.env.LOCAL_CLIENT_ID || "";
  const devBypassAllowed = isDev && !hasShopifyContext;

  if (!shopGuess && devBypassAllowed && devClientId) {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            DEV MODE: Using LOCAL_CLIENT_ID={devClientId}
          </div>
        </div>
        <HomeClient initialClientId={String(devClientId)} skipSupabaseAuth />
      </main>
    );
  }

  if (!shopGuess) {
    if (hasShopifyContext) {
      return <ShopifyBootstrap host={hostParam} />;
    }
    if (isDev) {
      return <HomeClient />;
    }
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Open this app from Shopify Admin → Apps.</div>
      </main>
    );
  }

  const { data, error } = await supabaseAdmin()
    .from("shopify_app_installs")
    .select("access_token, client_id")
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
    const defaultClientId = process.env.DEFAULT_CLIENT_ID || "";
    const qs = new URLSearchParams({ shop: shopGuess });
    if (defaultClientId) qs.set("client_id", defaultClientId);
    redirect(`/api/shopify/oauth/start?${qs.toString()}`);
  }
  if (!data?.client_id) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">
          Shopify install is missing a client mapping. Please contact support.
        </div>
      </main>
    );
  }

  return <HomeClient initialClientId={String(data.client_id)} skipSupabaseAuth />;
}
