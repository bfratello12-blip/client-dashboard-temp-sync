"use client";

import { useEffect, useMemo, useState } from "react";
import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge/utilities";

type ShopifyBootstrapProps = {
  host?: string;
};

export default function ShopifyBootstrap({ host }: ShopifyBootstrapProps) {
  const [status, setStatus] = useState<"idle" | "missing-host" | "loading" | "error">("idle");
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "";

  const isShopifyEmbedded = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const isEmbedded =
      params.has("shop") ||
      params.has("host") ||
      params.has("embedded");
    return isEmbedded;
  }, []);

  const normalizedHost = useMemo(() => {
    const hostValue = host ? (Array.isArray(host) ? host[0] : host) : "";
    if (hostValue) return hostValue;

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("host") || "";
    }

    return "";
  }, [host]);

  useEffect(() => {
    if (!isShopifyEmbedded) {
      setStatus("missing-host");
      return;
    }

    const u = new URL(window.location.href);
    const already = u.searchParams.get("bootstrapped") === "1";
    const hasShop = Boolean(u.searchParams.get("shop"));
    if (already && !hasShop) {
      u.searchParams.delete("bootstrapped");
      window.history.replaceState({}, "", u.toString());
    }
    if (already && hasShop) {
      console.warn("[bootstrap] redirect skipped (bootstrapped=1)");
      return;
    }

    if (!normalizedHost) {
      console.warn("[app-entry] missing host param; open from Shopify Admin");
      setStatus("missing-host");
      return;
    }

    if (!apiKey) {
      console.error("[app-entry] missing NEXT_PUBLIC_SHOPIFY_API_KEY");
      setStatus("error");
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus("loading");
      try {
        console.debug("[AB INIT]", {
          href: window.location.href,
          host: normalizedHost,
          shop: new URLSearchParams(window.location.search).get("shop") || "",
          inIframe: window.self !== window.top,
        });
        const shopOrigin = new URLSearchParams(window.location.search).get("shop") || "";
        const app = createApp({
          apiKey,
          host: normalizedHost,
          forceRedirect: true,
        });
        const token = await getSessionToken(app);
        if (cancelled) return;

        const res = await fetch("/api/shopify/whoami", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = (await res.json()) as { ok: boolean; shop?: string };
        console.log("[bootstrap] whoami response", { ok: data?.ok, shop: data?.shop });
        if (!data?.ok || !data.shop) {
          setStatus("error");
          return;
        }

        const params = new URLSearchParams();
        params.set("bootstrapped", "1");
        if (normalizedHost) params.set("host", normalizedHost);
        if (data?.shop) params.set("shop", data.shop);
        console.log("[bootstrap] redirecting to app root with shop+host");
        window.location.replace(`/?${params.toString()}`);
      } catch {
        setStatus("error");
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [apiKey, normalizedHost, isShopifyEmbedded]);

  if (status === "missing-host") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">
          Open this app from Shopify Admin.
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Unable to bootstrap app.</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-slate-600">Loading…</div>
    </main>
  );
}
