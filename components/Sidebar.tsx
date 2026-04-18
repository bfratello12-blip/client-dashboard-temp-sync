"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, Package, TrendingUp, Zap, Settings, Shield } from "lucide-react";
import { type User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import useClientId from "@/hooks/useClientId";
import { getContextValueClient } from "@/lib/shopifyContext";

interface SidebarProps {
  clientName: string;
  windowStartISO: string;
  windowEndISO: string;
  coverageLabel: string;
  compareCoverageLabel: string;
  effectiveShowComparison: boolean;
  loading: boolean;
}

type CostCoverageState = {
  soldUnitCoveragePct: number | null;
  soldUnitCoverageHasRows: boolean;
  catalogCoveragePct: number | null;
  catalogCoverageHasRows: boolean;
  loading: boolean;
  error: string;
};

function emptyCostCoverageState(): CostCoverageState {
  return {
    soldUnitCoveragePct: null,
    soldUnitCoverageHasRows: false,
    catalogCoveragePct: null,
    catalogCoverageHasRows: false,
    loading: false,
    error: "",
  };
}

function coverageTone(value: number | null) {
  if (value == null) return "text-slate-600";
  if (value >= 0.75) return "text-emerald-600";
  if (value >= 0.5) return "text-amber-600";
  return "text-rose-600";
}

function formatCoverageValue(value: number | null, hasRows: boolean) {
  if (!hasRows || value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function CoverageMetricCard({
  label,
  value,
  hasRows,
  help,
}: {
  label: string;
  value: number | null;
  hasRows: boolean;
  help: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={["mt-1 text-base font-semibold", coverageTone(hasRows ? value : null)].join(" ")}>
        {formatCoverageValue(value, hasRows)}
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{help}</div>
    </div>
  );
}

function NavItem({
  href,
  active,
  label,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={[
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors border-l-[3px]",
        active
          ? "border-l-blue-500 bg-slate-50 text-slate-900 font-medium"
          : "border-l-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-normal",
      ].join(" ")}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </Link>
  );
}

export default function Sidebar({
  clientName,
  windowStartISO,
  windowEndISO,
  coverageLabel,
  compareCoverageLabel,
  effectiveShowComparison,
  loading,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clientId = useClientId();
  const [supabaseUser, setSupabaseUser] = React.useState<User | null>(null);
  const [costCoverage, setCostCoverage] = React.useState<CostCoverageState>(emptyCostCoverageState);
  const shopDomainParam = (
    getContextValueClient(searchParams as any, "shop_domain") ||
    getContextValueClient(searchParams as any, "shop") ||
    ""
  )
    .trim()
    .toLowerCase();
  const contextClientId = getContextValueClient(searchParams as any, "client_id").trim();
  const [resolvedShopDomain, setResolvedShopDomain] = React.useState<string>(shopDomainParam);
  const effectiveShopDomain = (shopDomainParam || resolvedShopDomain || "").trim().toLowerCase();
  const effectiveClientId = String(clientId || contextClientId || "").trim();

  const withClientId = React.useCallback(
    (path: string) => {
      const qs = new URLSearchParams();
      const liveParams =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

      const shop =
        (searchParams.get("shop") || liveParams?.get("shop") || getContextValueClient(searchParams as any, "shop") || "").trim();
      const shopDomain =
        (searchParams.get("shop_domain") ||
          liveParams?.get("shop_domain") ||
          getContextValueClient(searchParams as any, "shop_domain") ||
          "").trim();
      const effectiveShopDomain = shopDomain || shop;
      const host =
        (searchParams.get("host") || liveParams?.get("host") || getContextValueClient(searchParams as any, "host") || "").trim();
      const embedded =
        (searchParams.get("embedded") ||
          liveParams?.get("embedded") ||
          getContextValueClient(searchParams as any, "embedded") ||
          "").trim();
      const contextClientId = getContextValueClient(searchParams as any, "client_id").trim();

      if (shop) qs.set("shop", shop);
      if (effectiveShopDomain) qs.set("shop_domain", effectiveShopDomain);
      if (host) qs.set("host", host);
      if (embedded) qs.set("embedded", embedded);
      if (clientId || contextClientId) qs.set("client_id", clientId || contextClientId);

      const query = qs.toString();
      return query ? `${path}?${query}` : path;
    },
    [clientId, searchParams]
  );

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSupabaseUser(data.session?.user ?? null);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!shopDomainParam) return;
    setResolvedShopDomain(shopDomainParam);
  }, [shopDomainParam]);

  React.useEffect(() => {
    if (shopDomainParam || resolvedShopDomain || !(clientId || contextClientId)) return;
    let cancelled = false;

    (async () => {
      try {
        const effectiveClientId = String(clientId || contextClientId || "").trim();
        if (!effectiveClientId) return;

        const res = await fetch(`/api/client/context?client_id=${encodeURIComponent(effectiveClientId)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        const recovered = String(json?.shop_domain || "").trim().toLowerCase();
        if (!cancelled && res.ok && json?.ok && recovered) {
          setResolvedShopDomain(recovered);
        }
      } catch {
        // no-op; cost coverage will stay empty until context becomes available
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopDomainParam, resolvedShopDomain, clientId, contextClientId]);

  React.useEffect(() => {
    let cancelled = false;

    if (!effectiveShopDomain && !effectiveClientId) {
      setCostCoverage(emptyCostCoverageState());
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      try {
        setCostCoverage((current) => ({ ...current, loading: true, error: "" }));
        const params = new URLSearchParams();
        if (effectiveShopDomain) {
          params.set("shop_domain", effectiveShopDomain);
        } else if (effectiveClientId) {
          params.set("client_id", effectiveClientId);
        }

        const res = await authenticatedFetch(`/api/settings/coverage?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Coverage request failed (${res.status})`);
        }

        if (!cancelled) {
          const soldUnitCoveragePct = Number(json?.unitCostCoveragePct);
          const catalogCoveragePct = Number(json?.catalogCoveragePct);
          setCostCoverage({
            soldUnitCoveragePct: Number.isFinite(soldUnitCoveragePct) ? soldUnitCoveragePct : null,
            soldUnitCoverageHasRows: Boolean(json?.unitCostCoverageHasRows),
            catalogCoveragePct: Number.isFinite(catalogCoveragePct) ? catalogCoveragePct : null,
            catalogCoverageHasRows: Boolean(json?.catalogCoverageHasRows),
            loading: false,
            error: "",
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          setCostCoverage({
            ...emptyCostCoverageState(),
            error: error?.message || "Unable to load cost coverage",
          });
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [effectiveShopDomain, effectiveClientId]);

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        {/* Brand mark (place ScaleAble_Logo1.svg in /public) */}
        <img
          src="/ScaleAble_Logo1.svg"
          alt="ScaleAble"
          className="h-auto max-w-[150px] object-contain"
        />
        <div className="sr-only text-xl font-semibold text-slate-900">ScaleAble</div>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">Client Portal</div>

      <nav className="mt-8 space-y-1">
        <NavItem href={withClientId("/")} active={pathname === "/"} label="Dashboard" icon={<LayoutDashboard size={18} />} />
        <NavItem
          href={withClientId("/product-performance")}
          active={pathname?.startsWith("/product-performance")}
          label="Product Performance"
          icon={<Package size={18} />}
        />
        <NavItem
          href={withClientId("/channel-performance")}
          active={pathname?.startsWith("/channel-performance")}
          label="Channel Revenue vs Ad Spend"
          icon={<TrendingUp size={18} />}
        />
        <NavItem
          href={withClientId("/campaign-performance")}
          active={pathname?.startsWith("/campaign-performance")}
          label="Campaign Performance"
          icon={<Zap size={18} />}
        />
        <NavItem href={withClientId("/settings")} active={pathname?.startsWith("/settings")} label="Settings" icon={<Settings size={18} />} />
        {supabaseUser ? (
          <NavItem href={withClientId("/admin")} active={pathname?.startsWith("/admin")} label="Admin" icon={<Shield size={18} />} />
        ) : null}
      </nav>

      {/* Data health panel */}
      <div className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Data health</div>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              costCoverage.loading
                ? "bg-slate-100 text-slate-600"
                : costCoverage.error
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700",
            ].join(" ")}
          >
            {costCoverage.loading ? "Loading" : costCoverage.error ? "Unavailable" : "Cost coverage"}
          </span>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Same cost coverage metrics shown in Settings → Product costs.
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <CoverageMetricCard
            label="Sold Unit Coverage (7d)"
            value={costCoverage.soldUnitCoveragePct}
            hasRows={costCoverage.soldUnitCoverageHasRows}
            help="% of units sold in the last 7 days that have a Shopify unit cost."
          />
          <CoverageMetricCard
            label="Catalog Coverage"
            value={costCoverage.catalogCoveragePct}
            hasRows={costCoverage.catalogCoverageHasRows}
            help="% of synced Shopify variants in this store that have a Shopify unit cost."
          />
        </div>

        {costCoverage.error ? <div className="mt-2 text-[11px] text-rose-700">{costCoverage.error}</div> : null}
      </div>

      <div className="mt-auto rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="text-xs font-medium text-slate-600">Client</div>
        <div className="mt-1 text-sm font-semibold text-slate-900">{clientName || "Loading…"}</div>
        <div className="mt-2 text-xs text-slate-500">{loading ? "Syncing…" : "Up to date"}</div>
        <div className="mt-1 text-[11px] text-slate-400">
          Window: {windowStartISO || "—"} → {windowEndISO || "—"}
        </div>
        <div className="mt-2 text-[11px] text-slate-500">Coverage: {coverageLabel}</div>
        {effectiveShowComparison ? <div className="mt-1 text-[11px] text-slate-400">{compareCoverageLabel}</div> : null}
      </div>
    </aside>
  );
}