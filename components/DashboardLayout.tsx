"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    const checkAuth = async () => {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.error(sessionErr);
        router.push("/login");
        return;
      }

      const userId = sessionData.session?.user?.id;
      if (!userId) {
        router.push("/login");
        return;
      }

      const { data: mapping, error: mapErr } = await supabase
        .from("user_clients")
        .select("client_id")
        .eq("user_id", userId)
        .limit(1);

      if (mapErr) {
        console.error(mapErr);
        return;
      }

      const cid = mapping?.[0]?.client_id as string | undefined;
      if (cid) {
        setClientId(cid);

        const { data: clientRow } = await supabase.from("clients").select("name").eq("id", cid).limit(1);
        if (clientRow?.[0]?.name) {
          setClientName(clientRow[0].name);
        }
      }

      setLoading(false);
    };

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

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