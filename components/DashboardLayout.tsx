"use client";

import React, { useState } from "react";
import Sidebar from "@/components/Sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  skipSupabaseAuth?: boolean;
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

      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}