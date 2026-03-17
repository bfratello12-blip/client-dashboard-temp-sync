import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import ProductPerformanceClient from "./ProductPerformanceClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getFirstClientIdForSupabaseUser,
  getSupabaseUserIdFromRequest,
  resolveClientIdFromShopDomainParam,
} from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

function normalizeShopDomain(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  const noProto = s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return noProto.endsWith(".myshopify.com") ? noProto : `${noProto}.myshopify.com`;
}

export default async function ProductPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientIdRaw = sp?.client_id;
  const clientId =
    typeof clientIdRaw === "string"
      ? clientIdRaw
      : Array.isArray(clientIdRaw)
      ? clientIdRaw[0]
      : "";
  const shopRaw = sp?.shop;
  const shop =
    typeof shopRaw === "string"
      ? shopRaw
      : Array.isArray(shopRaw)
      ? shopRaw[0]
      : "";
  const shopDomainRaw = sp?.shop_domain;
  const shopDomain =
    typeof shopDomainRaw === "string"
      ? shopDomainRaw
      : Array.isArray(shopDomainRaw)
      ? shopDomainRaw[0]
      : "";
  const hostRaw = sp?.host;
  const host =
    typeof hostRaw === "string"
      ? hostRaw
      : Array.isArray(hostRaw)
      ? hostRaw[0]
      : "";
  const embeddedRaw = sp?.embedded;
  const embedded =
    typeof embeddedRaw === "string"
      ? embeddedRaw
      : Array.isArray(embeddedRaw)
      ? embeddedRaw[0]
      : "";
  const pinnedClientId = String(process.env.DEFAULT_CLIENT_ID || "").trim();
  const embeddedSignalsPresent = Boolean(shop || shopDomain || host || embedded === "1");

  if (pinnedClientId && !embeddedSignalsPresent && clientId !== pinnedClientId) {
    const qs = new URLSearchParams();
    qs.set("client_id", pinnedClientId);
    const normalizedShopDomain = normalizeShopDomain(shop || shopDomain);
    if (normalizedShopDomain) qs.set("shop_domain", normalizedShopDomain);
    redirect(`/product-performance?${qs.toString()}`);
  }

  const normalizedShop = normalizeShopDomain(shop || shopDomain);
  if (!clientId && normalizedShop) {
    const resolvedClientId = await resolveClientIdFromShopDomainParam(normalizedShop);
    if (resolvedClientId) {
      const qs = new URLSearchParams();
      qs.set("client_id", resolvedClientId);
      qs.set("shop_domain", normalizedShop);
      if (shop) qs.set("shop", shop);
      if (host) qs.set("host", host);
      if (embedded) qs.set("embedded", embedded);
      redirect(`/product-performance?${qs.toString()}`);
    }
  }

  if (!clientId && !normalizedShop) {
    try {
      const hdrs = await headers();
      const reqForAuth = new Request("http://local/product-performance", {
        headers: {
          cookie: hdrs.get("cookie") || "",
          authorization: hdrs.get("authorization") || "",
        },
      });
      const userId = await getSupabaseUserIdFromRequest(reqForAuth);
      if (userId) {
        const firstClientId = await getFirstClientIdForSupabaseUser(userId);
        if (firstClientId) {
          const { data: install } = await supabaseAdmin()
            .from("shopify_app_installs")
            .select("shop_domain")
            .eq("client_id", firstClientId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const resolvedShopDomain = normalizeShopDomain(String(install?.shop_domain || ""));
          const qs = new URLSearchParams();
          qs.set("client_id", firstClientId);
          if (resolvedShopDomain) qs.set("shop_domain", resolvedShopDomain);
          redirect(`/product-performance?${qs.toString()}`);
        }
      }
    } catch {
      // Fall through to render the client page if we cannot resolve context server-side.
    }
  }

  return (
    <Suspense
      fallback={
        <div className="p-6 md:p-8 text-sm text-slate-500">Loading product performance…</div>
      }
    >
      <ProductPerformanceClient />
    </Suspense>
  );
}
