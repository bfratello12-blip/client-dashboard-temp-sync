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
  const allowMultiClientAdmin =
    String(process.env.NEXT_PUBLIC_ALLOW_MULTI_CLIENT_ADMIN || "")
      .trim()
      .toLowerCase() === "true";

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (cancelled) return;

      if (userError || !userData.user) {
        router.replace("/admin/login");
        return;
      }

      const { data: accessRows, error: accessError } = await supabase
        .from("user_clients")
        .select("client_id")
        .eq("user_id", userData.user.id)
        .eq("client_id", clientId)
        .limit(1);

      if (cancelled) return;

      if (accessError) {
        setStatus("unauthorized");
        setMessage("Unauthorized access");
        return;
      }

      if (!accessRows?.length) {
        if (allowMultiClientAdmin) {
          try {
            const projectRes = await fetch("/api/client/project-default", { cache: "no-store" });
            const projectJson = await projectRes.json().catch(() => ({}));
            const projectDefaultClientId = String(projectJson?.client?.id || "").trim();
            if (projectRes.ok && projectJson?.ok && projectDefaultClientId === clientId) {
              setStatus("authorized");
              return;
            }
          } catch {
            // no-op
          }
        }
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
  }, [clientId, router, allowMultiClientAdmin]);

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
