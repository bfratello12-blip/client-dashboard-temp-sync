"use client";

import React, { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import useClientId from "@/hooks/useClientId";
import {
  getContextValueClient,
  hasShopifyContextClient,
  persistAppContextClient,
  persistAppContextFromSearchParamsClient,
} from "@/lib/shopifyContext";

interface DashboardLayoutProps {
  children: React.ReactNode;
  skipSupabaseAuth?: boolean;
  showClientIdWarning?: boolean;
}

function ClientIdWarningBanner() {
  const clientId = useClientId();
  const params = useSearchParams();
  const shop = (params.get("shop") || params.get("shop_domain") || "").trim();
  if (clientId || shop || hasShopifyContextClient()) return null;

  return (
    <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Missing client_id in URL
    </div>
  );
}

function ContextPersistence() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const clientId = useClientId();
  const [rehydrating, setRehydrating] = React.useState(false);

  React.useEffect(() => {
    persistAppContextFromSearchParamsClient(params as any);
  }, [params]);

  React.useEffect(() => {
    if (!clientId) return;
    persistAppContextClient({ client_id: clientId });
  }, [clientId]);

  React.useEffect(() => {
    const hasShopDomainInUrl = (params.get("shop_domain") || "").trim();
    if (hasShopDomainInUrl) return;

    const persistedShopDomain = getContextValueClient(params as any, "shop_domain").trim();
    if (!persistedShopDomain) return;

    const next = new URLSearchParams(params.toString());
    next.set("shop_domain", persistedShopDomain);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [params, pathname, router]);

  React.useEffect(() => {
    if (rehydrating) return;

    const hasShopDomain = (params.get("shop_domain") || "").trim();
    if (hasShopDomain) return;

    const persistedShopDomain = getContextValueClient(params as any, "shop_domain").trim();
    if (persistedShopDomain) return;

    const cid = getContextValueClient(params as any, "client_id").trim();
    if (!cid) return;

    let cancelled = false;
    const run = async () => {
      setRehydrating(true);
      try {
        const res = await fetch(`/api/client/context?client_id=${encodeURIComponent(cid)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        const resolvedShop = String(json?.shop_domain || "").trim().toLowerCase();
        if (!cancelled && res.ok && json?.ok && resolvedShop) {
          persistAppContextClient({ client_id: cid, shop_domain: resolvedShop, shop: resolvedShop });
          const next = new URLSearchParams(params.toString());
          next.set("shop_domain", resolvedShop);
          if (!next.get("client_id")) next.set("client_id", cid);
          const query = next.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }
      } finally {
        if (!cancelled) setRehydrating(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [params, pathname, router, rehydrating]);

  return null;
}

export default function DashboardLayout({ children, skipSupabaseAuth, showClientIdWarning = true }: DashboardLayoutProps) {
  void skipSupabaseAuth;
  const [clientName] = useState<string>("");
  const [loading] = useState(false);

  const [windowStartISO] = useState("");
  const [windowEndISO] = useState("");
  const [coverageLabel] = useState("100%");
  const [compareCoverageLabel] = useState("100%");
  const [effectiveShowComparison] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Suspense fallback={<aside className="hidden md:flex w-64 border-r border-slate-200 bg-white" />}>
        <Sidebar
          clientName={clientName}
          windowStartISO={windowStartISO}
          windowEndISO={windowEndISO}
          coverageLabel={coverageLabel}
          compareCoverageLabel={compareCoverageLabel}
          effectiveShowComparison={effectiveShowComparison}
          loading={loading}
        />
      </Suspense>

      <main className="flex-1 min-w-0">
        <Suspense fallback={null}>
          <ContextPersistence />
        </Suspense>
        <Suspense fallback={null}>
          {showClientIdWarning ? <ClientIdWarningBanner /> : null}
        </Suspense>
        {children}
      </main>
    </div>
  );
}