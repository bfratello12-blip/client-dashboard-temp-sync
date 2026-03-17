"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import AdminClientAccessGate from "@/app/components/AdminClientAccessGate";

type ClientRow = {
  id: string;
  name: string | null;
  projectDefault?: boolean;
};

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const allowMultiClientAdmin =
    String(process.env.NEXT_PUBLIC_ALLOW_MULTI_CLIENT_ADMIN || "")
      .trim()
      .toLowerCase() === "true";
  const selectedClientId = (searchParams.get("client_id") || "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projectClientId, setProjectClientId] = useState<string>("");
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/admin/clients", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!res.ok || !json?.ok) {
        if (!cancelled) {
          setError(json?.error || "Failed to load clients.");
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setClients(Array.isArray(json?.clients) ? json.clients : []);
        setProjectClientId(String(json?.meta?.projectDefaultClientId || ""));
        setIsGlobalAdmin(Boolean(json?.meta?.isGlobalAdmin));
        setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (allowMultiClientAdmin && selectedClientId) {
    return <AdminClientAccessGate clientId={selectedClientId} />;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Select a client to open their dashboard.</p>

          {loading ? <div className="mt-6 text-sm text-slate-500">Loading clients…</div> : null}

          {error ? (
            <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {!loading && !error ? (
            clients.length > 0 ? (
              <div className="mt-6 space-y-3">
                {clients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {client.name || "Unnamed Client"}
                      {projectClientId === client.id ? (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Project default
                        </span>
                      ) : null}
                      {isGlobalAdmin ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Global admin
                        </span>
                      ) : null}
                    </div>
                    <Link
                      href={
                        allowMultiClientAdmin
                          ? `/admin?client_id=${encodeURIComponent(client.id)}`
                          : `/?client_id=${encodeURIComponent(client.id)}`
                      }
                      className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Open Dashboard
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No clients are assigned to this user.
              </div>
            )
          ) : null}
        </div>
      </div>
    </main>
  );
}
