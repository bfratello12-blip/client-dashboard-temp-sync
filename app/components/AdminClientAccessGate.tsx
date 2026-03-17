"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HomeClient from "@/app/page.client";
import { supabase } from "@/lib/supabaseClient";

type AdminClientAccessGateProps = {
  clientId: string;
};

export default function AdminClientAccessGate({ clientId }: AdminClientAccessGateProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authorized" | "unauthorized">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token || "";
      if (sessionError || !accessToken) {
        router.replace("/admin/login");
        return;
      }

      const res = await fetch(`/api/admin/access?client_id=${encodeURIComponent(clientId)}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const json = await res.json().catch(() => ({}));

      if (cancelled) return;

      if (res.status === 401) {
        router.replace("/admin/login");
        return;
      }

      if (!res.ok || !json?.ok) {
        setStatus("unauthorized");
        setMessage(json?.error || "Unauthorized access");
        return;
      }

      if (!json?.authorized) {
        setStatus("unauthorized");
        setMessage("Unauthorized access");
        router.replace("/admin");
        return;
      }

      setStatus("authorized");
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [clientId, router]);

  if (status === "authorized") {
    return <HomeClient initialClientId={clientId} />;
  }

  if (status === "unauthorized") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-xl font-semibold text-slate-900">Unauthorized access</h1>
          <p className="mt-2 text-sm text-slate-600">{message || "You do not have permission to access this client."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="text-sm text-slate-600">Verifying access…</div>
    </main>
  );
}
