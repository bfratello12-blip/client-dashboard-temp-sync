"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import DashboardLayout from "@/components/DashboardLayout";

export const dynamic = "force-dynamic";

type ClientCostSettings = {
  client_id: string;
  default_gross_margin_pct: number | null;
  avg_cogs_per_unit: number | null;
  processing_fee_pct: number | null;
  processing_fee_fixed: number | null;
  pick_pack_per_order: number | null;
  shipping_subsidy_per_order: number | null;
  materials_per_order: number | null;
  other_variable_pct_revenue: number | null;
  other_fixed_per_day: number | null;
  margin_after_costs_pct: number | null;
};

type IntegrationStatus = {
  shopify: { connected: boolean; needsReconnect: boolean; shop?: string | null };
  google: { connected: boolean; hasToken?: boolean; customerId?: string | null };
  meta: { connected: boolean; hasToken?: boolean; accountId?: string | null };
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const TIMEZONE = "America/New_York";

function isoDateInTimeZone(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const yyyy = parts.find((p) => p.type === "year")?.value ?? "";
  const mm = parts.find((p) => p.type === "month")?.value ?? "";
  const dd = parts.find((p) => p.type === "day")?.value ?? "";
  return `${yyyy}-${mm}-${dd}`;
}

function last30DaysRangeISO(timeZone: string) {
  const endISO = isoDateInTimeZone(new Date(), timeZone);
  const endDate = new Date(`${endISO}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 29);
  const startISO = isoDateInTimeZone(endDate, timeZone);
  return { startISO, endISO };
}

function Field({
  label,
  help,
  rightHint,
  children,
}: {
  label: string;
  help?: string;
  rightHint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          {help ? <div className="mt-1 text-xs text-slate-500">{help}</div> : null}
        </div>
        {rightHint ? (
          <div className="shrink-0 rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
            {rightHint}
          </div>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SidebarItem({ label, href, active }: { label: string; href: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "flex items-center rounded-xl px-3 py-2 text-sm font-medium",
        active ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function formatPct(v: number | null) {
  if (v == null) return "";
  const n = Number(v);
  if (!isFinite(n)) return "";
  return n > 1 ? String(n) : String(Math.round(n * 10000) / 100); // show as percent if stored as fraction
}

function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("Client");

  const [costSettings, setCostSettings] = useState<ClientCostSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>("");
  const [cogsCoveragePct, setCogsCoveragePct] = useState<number | null>(null);

  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationError, setIntegrationError] = useState("");


  const [googleAccounts, setGoogleAccounts] = useState<Array<{ id: string; name?: string | null }>>([]);
  const [googleAccountsLoading, setGoogleAccountsLoading] = useState(false);
  const [googleAccountsError, setGoogleAccountsError] = useState("");
  const [googleSelectedAccountId, setGoogleSelectedAccountId] = useState("");
  const [googleAccountSaving, setGoogleAccountSaving] = useState(false);

  // Product cost source UX: Shopify unit costs vs estimated fallback inputs
  const [productCostMode, setProductCostMode] = useState<'shopify' | 'estimate'>('shopify');
  const normPct = (v: any): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    const frac = n > 1 ? n / 100 : n;
    return clamp(frac, 0, 1);
  };

  const normNum = (v: any): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  const setCS = useCallback(
    (key: keyof ClientCostSettings, raw: string) => {
      setSaveSuccess("");
      setSaveError("");
      setCostSettings((base) => {
        const next = (base || { client_id: clientId }) as ClientCostSettings;

        // keep raw input in state as numbers/null
        let nextVal: any = raw;
        if (key.endsWith("_pct")) nextVal = raw === "" ? null : Number(raw);
        else nextVal = raw === "" ? null : Number(raw);

        return { ...next, [key]: isFinite(nextVal as any) ? nextVal : null } as ClientCostSettings;
      });
    },
    [clientId]
  );

  const save = useCallback(async () => {
    if (!clientId) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess("");

    try {
      const cs = (costSettings || ({ client_id: clientId } as ClientCostSettings)) as ClientCostSettings;
      const payload: any = {
        client_id: clientId,
        default_gross_margin_pct: normPct(cs.default_gross_margin_pct),
        avg_cogs_per_unit: normNum(cs.avg_cogs_per_unit),
        processing_fee_pct: normPct(cs.processing_fee_pct),
        processing_fee_fixed: normNum(cs.processing_fee_fixed),
        pick_pack_per_order: normNum(cs.pick_pack_per_order),
        shipping_subsidy_per_order: normNum(cs.shipping_subsidy_per_order),
        materials_per_order: normNum(cs.materials_per_order),
        other_variable_pct_revenue: normPct(cs.other_variable_pct_revenue),
        other_fixed_per_day: normNum(cs.other_fixed_per_day),
        margin_after_costs_pct: normPct(cs.margin_after_costs_pct),
      };

      const syncToken = process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
      const res = await fetch("/api/client-cost-settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(syncToken ? { Authorization: `Bearer ${syncToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Save failed (${res.status})`);
      }

      const { startISO, endISO } = last30DaysRangeISO(TIMEZONE);
      const recomputeParams = new URLSearchParams({
        client_id: clientId,
        start: startISO,
        end: endISO,
      });
      if (syncToken) recomputeParams.set("token", syncToken);
      const recomputeUrl = `/api/shopify/recompute?${recomputeParams.toString()}`;
      const recomputeRes = await fetch(recomputeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!recomputeRes.ok) {
        const t = await recomputeRes.text().catch(() => "");
        throw new Error(t || `Recompute failed (${recomputeRes.status})`);
      }

      setSaveSuccess("Saved & updated last 30 days");
      router.refresh();
    } catch (e: any) {
      console.error(e);
      setSaveError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }, [clientId, costSettings, router]);

  const runRecompute = useCallback(async () => {
    try {
      setSaveError("");
      setSaveSuccess("");
      const res = await fetch(`/api/cron/rolling-30`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SYNC_TOKEN}`,
        },
      });
      if (!res.ok) throw new Error((await res.text()) || `Sync failed (${res.status})`);
      setSaveSuccess("Recompute started");
    } catch (e: any) {
      console.error(e);
      setSaveError(e?.message ?? "Recompute failed");
    }
  }, []);

  const syncAllPlatforms = useCallback(async () => {
    try {
      setSyncing(true);
      setSyncError("");
      setSaveError("");
      setSaveSuccess("");

      const syncToken = process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
      const syncParams = new URLSearchParams({ client_id: clientId });
      if (syncToken) syncParams.set("token", syncToken);
      const res = await fetch(`/api/cron/daily-sync?${syncParams.toString()}`, { method: "POST" });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Sync failed (${res.status})`);
      }

      setSaveSuccess("Sync completed successfully");
      router.refresh();
    } catch (e: any) {
      console.error(e);
      setSyncError(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [clientId, router]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  const openIntegration = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const startGoogleOAuth = useCallback(async () => {
    if (!clientId) return;

    try {
      const connectUrl = `/api/googleads/connect?client_id=${encodeURIComponent(clientId)}`;
      console.log("SETTINGS currentClientId", clientId);
      console.log("GOOGLE CONNECT url", connectUrl);
      const res = await fetch(connectUrl, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      const url = payload?.url as string | undefined;
      if (!res.ok || !url) throw new Error(payload?.error || `OAuth start failed (${res.status})`);

      if (window.top) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e: any) {
      console.error(e);
      setIntegrationError(e?.message ?? "Failed to start Google OAuth");
    }
  }, [clientId]);

  const fetchGoogleIntegration = useCallback(async () => {
    if (!clientId) return;

    const { data, error } = await supabase
      .from("client_integrations")
      .select("provider, google_refresh_token, google_ads_customer_id, google_customer_id, status, is_active")
      .eq("client_id", clientId)
      .eq("provider", "google_ads")
      .limit(1);

    if (error) {
      console.error(error);
      return;
    }

    const row = data?.[0] ?? null;
    const statusOk = row?.status === "connected" || row?.is_active === true;
    const hasToken = Boolean(String(row?.google_refresh_token ?? "").trim());
    const customerId = String(row?.google_customer_id ?? row?.google_ads_customer_id ?? "").trim();
    const hasCustomerId = Boolean(customerId);

    setIntegrationStatus((prev) => ({
      shopify: prev?.shopify ?? { connected: false, needsReconnect: false, shop: null },
      meta: prev?.meta ?? { connected: false },
      google: {
        connected: hasToken && hasCustomerId && statusOk,
        hasToken,
        customerId: hasCustomerId ? customerId : null,
      },
    }));
  }, [clientId]);

  const fetchIntegrationStatus = useCallback(async () => {
    if (!clientId) return;

    setIntegrationLoading(true);
    setIntegrationError("");

    try {
      const params = new URLSearchParams(window.location.search);
      const shopDomainParam = params.get("shop_domain") || params.get("shop") || "";
      const statusUrl = new URL("/api/integrations/status", window.location.origin);
      statusUrl.searchParams.set("client_id", clientId);
      if (shopDomainParam) statusUrl.searchParams.set("shop_domain", shopDomainParam);

      const res = await fetch(statusUrl.toString(), {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Status failed (${res.status})`);

      setIntegrationStatus((prev) => ({
        shopify: payload.shopify,
        meta: payload.meta,
        google: prev?.google ?? payload.google ?? { connected: false },
      }));
    } catch (e: any) {
      console.error(e);
      setIntegrationError(e?.message ?? "Failed to load integrations");
    } finally {
      setIntegrationLoading(false);
    }
  }, [clientId]);

  const fetchGoogleAccounts = useCallback(async () => {
    if (!clientId) return;
    setGoogleAccountsLoading(true);
    setGoogleAccountsError("");

    try {
      const res = await fetch(`/api/googleads/accounts?client_id=${encodeURIComponent(clientId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Account fetch failed (${res.status})`);

      const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
      setGoogleAccounts(accounts);
      if (!googleSelectedAccountId && accounts.length > 0) {
        setGoogleSelectedAccountId(String(accounts[0]?.id ?? ""));
      }
    } catch (e: any) {
      console.error(e);
      setGoogleAccountsError(e?.message ?? "Failed to load Google accounts");
    } finally {
      setGoogleAccountsLoading(false);
    }
  }, [clientId, googleSelectedAccountId]);

  const saveGoogleAccount = useCallback(async () => {
    if (!clientId || !googleSelectedAccountId) return;
    setGoogleAccountSaving(true);
    setIntegrationError("");

    try {
      const res = await fetch("/api/googleads/select-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, google_ads_customer_id: googleSelectedAccountId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Save failed (${res.status})`);

      await fetchIntegrationStatus();
      await fetchGoogleIntegration();
    } catch (e: any) {
      console.error(e);
      setIntegrationError(e?.message ?? "Failed to save Google account");
    } finally {
      setGoogleAccountSaving(false);
    }
  }, [clientId, googleSelectedAccountId, fetchIntegrationStatus, fetchGoogleIntegration]);

  const disconnectGoogleAds = useCallback(async () => {
    if (!clientId) return;
    setIntegrationError("");

    try {
      const res = await fetch("/api/googleads/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Disconnect failed (${res.status})`);

      setGoogleAccounts([]);
      setGoogleSelectedAccountId("");
      await fetchIntegrationStatus();
      await fetchGoogleIntegration();
    } catch (e: any) {
      console.error(e);
      setIntegrationError(e?.message ?? "Failed to disconnect Google Ads");
    }
  }, [clientId, fetchIntegrationStatus, fetchGoogleIntegration]);

  // Load: auth -> shop (sa_shop) -> client mapping -> cost settings
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) console.error(sessionErr);

      const userId = sessionData.session?.user?.id;
      if (!userId) {
        if (!cancelled) {
          setLoading(false);
          router.replace("/login");
        }
        return;
      }

      let shopDomain = document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("sa_shop="))
        ?.split("=")
        ?.slice(1)
        .join("=");

      if (!shopDomain) {
        try {
          const whoRes = await fetch("/api/shopify/whoami", { cache: "no-store" });
          const whoJson = await whoRes.json().catch(() => ({}));
          if (whoRes.ok && whoJson?.shop) {
            shopDomain = String(whoJson.shop).trim();
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (!shopDomain) {
        if (!cancelled) {
          setClientName("Unknown Store");
          setCostSettings(null);
          setLoading(false);
        }
        return;
      }

      const { data: installRows, error: installErr } = await supabase
        .from("shopify_app_installs")
        .select("client_id")
        .eq("shop_domain", shopDomain)
        .limit(1);

      if (installErr) {
        console.error(installErr);
        if (!cancelled) setLoading(false);
        return;
      }

      const cid = (installRows?.[0]?.client_id as string | undefined) || "";
      if (!cancelled) setClientId(cid);

      if (!cid) {
        if (!cancelled) {
          setClientName("Unassigned Client");
          setCostSettings(null);
          setLoading(false);
        }
        return;
      }

      // client name
      const { data: clientRow } = await supabase.from("clients").select("name").eq("id", cid).limit(1);
      if (!cancelled) setClientName((clientRow?.[0] as any)?.name ?? "Client");

      // cost settings
      const { data: csRow } = await supabase
        .from("client_cost_settings")
        .select(
          "client_id, default_gross_margin_pct, avg_cogs_per_unit, processing_fee_pct, processing_fee_fixed, pick_pack_per_order, shipping_subsidy_per_order, materials_per_order, other_variable_pct_revenue, other_fixed_per_day, margin_after_costs_pct"
        )
        .eq("client_id", cid)
        .limit(1);

      const row = (csRow?.[0] as any) || null;
      const settings: ClientCostSettings = {
        client_id: cid,
        default_gross_margin_pct: row?.default_gross_margin_pct != null ? Number(row.default_gross_margin_pct) : null,
        avg_cogs_per_unit: row?.avg_cogs_per_unit != null ? Number(row.avg_cogs_per_unit) : null,
        processing_fee_pct: row?.processing_fee_pct != null ? Number(row.processing_fee_pct) : null,
        processing_fee_fixed: row?.processing_fee_fixed != null ? Number(row.processing_fee_fixed) : null,
        pick_pack_per_order: row?.pick_pack_per_order != null ? Number(row.pick_pack_per_order) : null,
        shipping_subsidy_per_order: row?.shipping_subsidy_per_order != null ? Number(row.shipping_subsidy_per_order) : null,
        materials_per_order: row?.materials_per_order != null ? Number(row.materials_per_order) : null,
        other_variable_pct_revenue: row?.other_variable_pct_revenue != null ? Number(row.other_variable_pct_revenue) : null,
        other_fixed_per_day: row?.other_fixed_per_day != null ? Number(row.other_fixed_per_day) : null,
        margin_after_costs_pct: row?.margin_after_costs_pct != null ? Number(row.margin_after_costs_pct) : null,
      };

      if (!cancelled) {
        setCostSettings(settings);
        setLoading(false);
      }

      const end = new Date();
      const start = new Date(end.getTime() - 6 * 24 * 3600 * 1000);
      const endISO = end.toISOString().slice(0, 10);
      const startISO = start.toISOString().slice(0, 10);

      const { data: coverageRows } = await supabase
        .from("daily_profit_summary")
        .select("date,revenue,revenue_with_cogs")
        .eq("client_id", cid)
        .gte("date", startISO)
        .lte("date", endISO)
        .order("date", { ascending: false })
        .limit(1000);

      const totals = (coverageRows ?? []).reduce(
        (acc, row: any) => {
          acc.revenue += Number(row?.revenue ?? 0);
          acc.revenueWithCogs += Number(row?.revenue_with_cogs ?? 0);
          return acc;
        },
        { revenue: 0, revenueWithCogs: 0 }
      );
      const weighted = totals.revenue > 0 ? totals.revenueWithCogs / totals.revenue : null;
      if (!cancelled) {
        setCogsCoveragePct(Number.isFinite(Number(weighted)) ? Number(weighted) : null);
      }
    };

    run();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!clientId) {
      setIntegrationStatus(null);
      return;
    }

    const run = async () => {
      await fetchIntegrationStatus();
    };

    run();
  }, [clientId, fetchIntegrationStatus]);

  useEffect(() => {
    if (!clientId) return;
    fetchGoogleIntegration();
  }, [clientId, fetchGoogleIntegration]);

  useEffect(() => {
    if (!clientId) return;
    setGoogleAccounts([]);
    setGoogleSelectedAccountId("");
    setGoogleAccountsError("");
  }, [clientId]);

  useEffect(() => {
    if (integrationStatus?.google?.hasToken) return;
    setGoogleAccounts([]);
    setGoogleSelectedAccountId("");
    setGoogleAccountsError("");
  }, [integrationStatus?.google?.hasToken]);

  useEffect(() => {
    if (!clientId) return;
    if (!integrationStatus?.google?.hasToken) return;
    if (integrationStatus?.google?.customerId) return;
    if (googleAccountsLoading || googleAccounts.length > 0) return;

    fetchGoogleAccounts();
  }, [
    clientId,
    integrationStatus?.google?.hasToken,
    integrationStatus?.google?.customerId,
    googleAccountsLoading,
    googleAccounts.length,
    fetchGoogleAccounts,
  ]);

  const costs = useMemo(() => costSettings || ({ client_id: clientId } as ClientCostSettings), [costSettings, clientId]);

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-[1400px] gap-6 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Settings</div>
              <div className="mt-1 text-sm text-slate-600">
                Configure how ScaleAble calculates profit and how your data is refreshed.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={syncAllPlatforms}
                disabled={syncing}
                className={`rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${
                  syncing ? "cursor-not-allowed opacity-60" : ""
                }`}
                title="Pull latest Meta, Google, and Shopify data"
              >
                {syncing ? "Syncing..." : "Sync & Refresh (Last 30 Days)"}
              </button>
              <button
                onClick={save}
                disabled={saving || !clientId}
                className="rounded-xl bg-gradient-to-b from-[#2B72D7] to-[#1f5fb8] px-4 py-2 text-sm font-semibold text-white hover:bg-gradient-to-b hover:from-[#1f5fb8] hover:to-[#1a4a9a] disabled:opacity-50"
              >
                {saving ? "Saving & Updating…" : "Save changes"}
              </button>
            </div>
          </header>

          {saveError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{saveError}</div>
          ) : null}
          {saveSuccess ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {saveSuccess}
            </div>
          ) : null}
          {syncError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{syncError}</div>
          ) : null}

          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold text-slate-900">Integrations</div>
                <div className="mt-1 text-sm text-slate-500">Connect your ad platforms and Shopify store.</div>
              </div>
              {integrationLoading ? (
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  Checking…
                </div>
              ) : null}
            </div>

            {integrationError ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {integrationError}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Shopify</div>
                  <div className="mt-1 text-xs text-slate-500">Orders and revenue from your store.</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        integrationStatus?.shopify?.connected ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    {integrationStatus?.shopify?.connected ? "Connected" : "Disconnected"}
                  </div>
                  <button
                    onClick={() =>
                      openIntegration(`/api/shopify/oauth/start?client_id=${encodeURIComponent(clientId)}`)
                    }
                    disabled={!clientId || integrationStatus?.shopify?.connected}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                      integrationStatus?.shopify?.connected || !clientId
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {integrationStatus?.shopify?.connected
                      ? "Connected"
                      : integrationStatus?.shopify?.needsReconnect
                        ? "Reconnect"
                        : "Connect"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Google Ads</div>
                  <div className="mt-1 text-xs text-slate-500">Paid search spend and conversions.</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        integrationStatus?.google?.connected ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    {integrationStatus?.google?.connected
                      ? "Connected"
                      : integrationStatus?.google?.hasToken
                        ? "Needs account selection"
                        : "Disconnected"}
                  </div>
                  {integrationStatus?.google?.connected ? (
                    <div className="text-xs text-slate-600">
                      Account: <span className="font-semibold text-slate-800">{integrationStatus?.google?.customerId}</span>
                    </div>
                  ) : null}

                  {integrationStatus?.google?.connected ? (
                    <button
                      onClick={disconnectGoogleAds}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                      Disconnect
                    </button>
                  ) : !integrationStatus?.google?.hasToken ? (
                    <button
                      onClick={startGoogleOAuth}
                      disabled={!clientId}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                        !clientId ? "cursor-not-allowed bg-slate-300" : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      Connect Google Ads
                    </button>
                  ) : (
                    <button
                      onClick={startGoogleOAuth}
                      disabled={!clientId}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                        !clientId ? "cursor-not-allowed bg-slate-300" : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              </div>

              {integrationStatus?.google?.hasToken && !integrationStatus?.google?.customerId ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Select Google Ads Account</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Choose the account to sync for this client.
                  </div>

                  {googleAccountsError ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                      {googleAccountsError}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      value={googleSelectedAccountId}
                      onChange={(e) => setGoogleSelectedAccountId(e.target.value)}
                      disabled={googleAccountsLoading || googleAccounts.length === 0}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:max-w-md"
                    >
                      {googleAccountsLoading ? (
                        <option>Loading accounts…</option>
                      ) : googleAccounts.length === 0 ? (
                        <option>No accounts found</option>
                      ) : (
                        googleAccounts.map((acct) => (
                          <option key={acct.id} value={acct.id}>
                            {acct.name ? `${acct.name} (${acct.id})` : acct.id}
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      onClick={saveGoogleAccount}
                      disabled={!googleSelectedAccountId || googleAccountSaving}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                        !googleSelectedAccountId || googleAccountSaving
                          ? "cursor-not-allowed bg-slate-300"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      {googleAccountSaving ? "Saving…" : "Save account"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Meta Ads</div>
                  <div className="mt-1 text-xs text-slate-500">Paid social spend and conversions.</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        integrationStatus?.meta?.connected ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    {integrationStatus?.meta?.connected ? "Connected" : "Disconnected"}
                  </div>
                  <button
                    onClick={() => openIntegration(`/api/meta/connect?client_id=${encodeURIComponent(clientId)}`)}
                    disabled={!clientId || integrationStatus?.meta?.connected}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                      integrationStatus?.meta?.connected || !clientId
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {integrationStatus?.meta?.connected ? "Connected" : "Connect"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="text-base font-semibold text-slate-900">Costs & margins</div>
            <div className="mt-1 text-sm text-slate-500">
              These inputs power Contribution Profit and Profit Return on Costs. Leave blank if you don’t know it yet.
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Field
                label="Product costs"
                help="ScaleAble will use Shopify unit costs (COGS) when available. If you don’t have unit costs filled out in Shopify, you can provide an estimate instead."
                rightHint="Required"
              >
                <div className="space-y-3">
                  {/* Option 1: Shopify unit costs */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={productCostMode === "shopify"}
                      onChange={(e) => {
                        // Keep at least one option selected
                        if (e.target.checked) setProductCostMode("shopify");
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">Use Shopify unit costs</div>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200">
                          Recommended
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        We’ll pull unit costs from Shopify products/line items whenever they’re available.
                      </div>
                      {productCostMode === "shopify" ? (
                        <div className="mt-2 text-xs text-slate-600">
                          <div className="font-semibold text-slate-700">COGS coverage (last 7 days)</div>
                          <div
                            className={[
                              "mt-0.5",
                              cogsCoveragePct == null
                                ? "text-slate-600"
                                : cogsCoveragePct >= 0.75
                                ? "text-emerald-600"
                                : cogsCoveragePct >= 0.5
                                ? "text-amber-600"
                                : "text-rose-600",
                            ].join(" ")}
                          >
                            {cogsCoveragePct == null ? "—" : `${Math.round(cogsCoveragePct * 100)}%`}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            % of revenue from products with a Shopify unit cost.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </label>

                  {/* Option 2: Estimates */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={productCostMode === "estimate"}
                      onChange={(e) => {
                        if (e.target.checked) setProductCostMode("estimate");
                        else setProductCostMode("shopify"); // revert so one stays selected
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">
                        Use estimated gross margin or avg COGS per unit when missing
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (used only if Shopify unit costs are not available)
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Choose this if Shopify unit costs aren’t available yet. You can refine later.
                      </div>

                      {productCostMode === "estimate" ? (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-slate-700">
                              Fallback gross margin (%) — used when Shopify unit cost is missing
                              <input
                                value={formatPct(costs.default_gross_margin_pct)}
                                onChange={(e) => setCS("default_gross_margin_pct", e.target.value)}
                                inputMode="decimal"
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                placeholder="e.g. 55"
                              />
                              <div className="mt-1 text-[11px] text-slate-500">
                                Applies only when inventoryItem.unitCost is null; otherwise actual unit cost is used.
                              </div>
                            </label>

                            <label className="text-xs font-semibold text-slate-700">
                              Avg COGS per unit ($)
                              <input
                                value={costs.avg_cogs_per_unit ?? ""}
                                onChange={(e) => setCS("avg_cogs_per_unit", e.target.value)}
                                inputMode="decimal"
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                placeholder="e.g. 18.50"
                              />
                              <div className="mt-1 text-[11px] text-slate-500">
                                Optional alternative if you know your average unit cost.
                              </div>
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </label>

                  {productCostMode === "shopify" ? (
                    <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
                      <div className="text-xs font-semibold text-slate-700">Fallback gross margin (%) (optional)</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Used only when a product is missing a Shopify unit cost.
                      </div>
                      <input
                        value={formatPct(costs.default_gross_margin_pct)}
                        onChange={(e) => setCS("default_gross_margin_pct", e.target.value)}
                        inputMode="decimal"
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        placeholder="e.g. 55"
                      />
                    </div>
                  ) : null}
                </div>
              </Field>

              <Field
                label="Payment processing"
                help="Used to estimate payment fees when you don’t want to model them from payouts."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Processing fee %
                    <input
                      value={formatPct(costs.processing_fee_pct)}
                      onChange={(e) => setCS("processing_fee_pct", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 2.9"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-700">
                    Fixed per order ($)
                    <input
                      value={costs.processing_fee_fixed ?? ""}
                      onChange={(e) => setCS("processing_fee_fixed", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 0.30"
                    />
                  </label>
                </div>
              </Field>

              <Field
                label="Fulfillment & shipping"
                help="If you use a 3PL, include pick-pack fees and the typical shipping subsidy you cover."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-700">
                    Pick/pack per order ($)
                    <input
                      value={costs.pick_pack_per_order ?? ""}
                      onChange={(e) => setCS("pick_pack_per_order", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 2.25"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-700">
                    Shipping subsidy ($)
                    <input
                      value={costs.shipping_subsidy_per_order ?? ""}
                      onChange={(e) => setCS("shipping_subsidy_per_order", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 4.00"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-700">
                    Packaging/materials ($)
                    <input
                      value={costs.materials_per_order ?? ""}
                      onChange={(e) => setCS("materials_per_order", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 0.75"
                    />
                  </label>
                </div>
              </Field>

              <Field
                label="Other costs"
                help="Optional knobs if you want profitability to be closer to true contribution margin."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Other variable % of revenue
                    <input
                      value={formatPct(costs.other_variable_pct_revenue)}
                      onChange={(e) => setCS("other_variable_pct_revenue", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 1.0"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-700">
                    Other fixed per day ($)
                    <input
                      value={costs.other_fixed_per_day ?? ""}
                      onChange={(e) => setCS("other_fixed_per_day", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="e.g. 25"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-700">
                    Margin after costs %
                    <input
                      value={formatPct(costs.margin_after_costs_pct)}
                      onChange={(e) => setCS("margin_after_costs_pct", e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="optional"
                    />
                    <div className="mt-1 text-[11px] text-slate-500">
                      Optional override used by some legacy calcs. You can ignore this unless you know you need it.
                    </div>
                  </label>
                </div>
              </Field>
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold text-slate-900">Coming soon</div>
            <div className="mt-1 text-sm text-slate-500">
              Good future Settings candidates for ScaleAble:
              <ul className="mt-2 list-disc pl-5">
                <li>Attribution window defaults (7/14/30 day views)</li>
                <li>Channel inclusion toggles (Google / Meta / other paid)</li>
                <li>Profit definitions (include fixed costs vs contribution only)</li>
                <li>Alerts (profit MER drops, spend spikes, tracking breaks)</li>
              </ul>
            </div>
          </section>

          <div className="h-12" />
        </div>
      </div>
    </DashboardLayout>
  );
}

export default SettingsPage;
