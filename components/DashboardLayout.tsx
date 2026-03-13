"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import useClientId from "@/hooks/useClientId";

interface DashboardLayoutProps {
  children: React.ReactNode;
  skipSupabaseAuth?: boolean;
}

function ClientIdWarningBanner() {
  const clientId = useClientId();
  const params = useSearchParams();
  const shop = (params.get("shop") || "").trim();
  if (clientId || shop) return null;

  return (
    <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Missing client_id in URL
    </div>
  );
}

export default function DashboardLayout({ children, skipSupabaseAuth }: DashboardLayoutProps) {
  void skipSupabaseAuth;
  const [clientName] = useState<string>("");
  const [loading] = useState(false);

  // Mock data health values - these would normally come from the main dashboard state
  const [dataHealth] = useState({
    missingShopify: 0,
    missingAds: 0,
    missingCompareShopify: 0,
    missingCompareAds: 0,
  });

  const [comparisonEnabled] = useState(false);
  const [comparisonAvailable] = useState(true);
  const [compareDisabledReason] = useState<string | null>(null);

  const [conf] = useState({
    tone: "bg-green-100 text-green-700",
    label: "On",
  });

  const [windowStartISO] = useState("");
  const [windowEndISO] = useState("");
  const [coverageLabel] = useState("100%");
  const [compareCoverageLabel] = useState("100%");
  const [effectiveShowComparison] = useState(false);
  const [lastSalesDateISO] = useState("");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Suspense fallback={<aside className="hidden md:flex w-64 border-r border-slate-200 bg-white" />}>
        <Sidebar
          clientName={clientName}
          lastSalesDateISO={lastSalesDateISO}
          dataHealth={dataHealth}
          comparisonEnabled={comparisonEnabled}
          comparisonAvailable={comparisonAvailable}
          compareDisabledReason={compareDisabledReason}
          conf={conf}
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
          <ClientIdWarningBanner />
        </Suspense>
        {children}
      </main>
    </div>
  );
}