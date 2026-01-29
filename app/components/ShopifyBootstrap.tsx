"use client";

import { useEffect, useMemo, useState } from "react";
import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge-utils";

type ShopifyBootstrapProps = {
  host?: string;
};

export default function ShopifyBootstrap({ host }: ShopifyBootstrapProps) {
  const [status, setStatus] = useState<"idle" | "missing-host" | "loading" | "error">("idle");
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "";

  const normalizedHost = useMemo(() => {
    const hostValue = host ? (Array.isArray(host) ? host[0] : host) : "";
    if (hostValue) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("shopify.host", hostValue);
      }
      return hostValue;
    }

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const hostFromQuery = params.get("host") || "";
      if (hostFromQuery) {
        window.localStorage.setItem("shopify.host", hostFromQuery);
        return hostFromQuery;
      }

      const storedHost = window.localStorage.getItem("shopify.host") || "";
      if (storedHost) return storedHost;
    }

    return "";
  }, [host]);

  useEffect(() => {
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
        if (!data?.ok || !data.shop) {
          setStatus("error");
          return;
        }

        const params = new URLSearchParams();
        params.set("shop", data.shop);
        params.set("host", normalizedHost);
        params.set("embedded", "1");
        window.location.replace(`/?${params.toString()}`);
      } catch {
        setStatus("error");
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [apiKey, normalizedHost]);

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
