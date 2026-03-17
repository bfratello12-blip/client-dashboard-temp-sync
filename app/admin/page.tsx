"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AdminClientAccessGate from "@/app/components/AdminClientAccessGate";

type ClientRow = {
  id: string;
  name: string | null;
};

type UserClientJoinRow = {
  client_id: string;
  clients: ClientRow | ClientRow[] | null;
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
  const [projectClient, setProjectClient] = useState<ClientRow | null>(null);

  if (allowMultiClientAdmin && selectedClientId) {
    return <AdminClientAccessGate clientId={selectedClientId} />;
  }

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError) {
        if (!cancelled) {
          setError(userError.message || "Unable to verify authentication.");
          setLoading(false);
        }
        return;
      }

      const userId = userData.user?.id;
      if (!userId) {
        router.replace("/admin/login");
        return;
      }

      const { data, error: mapError } = await supabase
        .from("user_clients")
        .select("client_id, clients(id, name)")
        .eq("user_id", userId);

      if (mapError) {
        if (!cancelled) {
          setError(mapError.message || "Failed to load clients.");
          setLoading(false);
        }
        return;
      }

      const normalized = ((data || []) as UserClientJoinRow[])
        .map((row) => {
          const joined = Array.isArray(row.clients) ? row.clients[0] : row.clients;
          const id = joined?.id || row.client_id;
          const name = joined?.name || "Unnamed Client";
          return { id, name };
        })
        .filter((row) => Boolean(row.id));

      let projectDefaultClient: ClientRow | null = null;
      if (allowMultiClientAdmin) {
        try {
          const projectRes = await fetch("/api/client/project-default", { cache: "no-store" });
          const projectJson = await projectRes.json().catch(() => ({}));
          const projectId = String(projectJson?.client?.id || "").trim();
          if (projectRes.ok && projectJson?.ok && projectId) {
            projectDefaultClient = {
              id: projectId,
              name: String(projectJson?.client?.name || "Project Default Client"),
            };
          }
        } catch {
          // no-op; admin list will fall back to assigned clients only
        }
      }

      const merged = [...normalized];
      if (projectDefaultClient && !merged.some((c) => c.id === projectDefaultClient?.id)) {
        merged.unshift(projectDefaultClient);
      }

      if (!cancelled) {
        setProjectClient(projectDefaultClient);
        setClients(merged);
        setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

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
                      {projectClient?.id === client.id ? (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Project default
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
