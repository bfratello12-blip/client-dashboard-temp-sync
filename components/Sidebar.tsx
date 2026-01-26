"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  clientName: string;
  lastSalesDateISO: string;
  dataHealth: {
    missingShopify: number;
    missingAds: number;
    missingCompareShopify: number;
    missingCompareAds: number;
  };
  comparisonEnabled: boolean;
  comparisonAvailable: boolean;
  compareDisabledReason: string | null;
  conf: {
    tone: string;
    label: string;
  };
  windowStartISO: string;
  windowEndISO: string;
  coverageLabel: string;
  compareCoverageLabel: string;
  effectiveShowComparison: boolean;
  loading: boolean;
}

function NavItem({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={[
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function Sidebar({
  clientName,
  lastSalesDateISO,
  dataHealth,
  comparisonEnabled,
  comparisonAvailable,
  compareDisabledReason,
  conf,
  windowStartISO,
  windowEndISO,
  coverageLabel,
  compareCoverageLabel,
  effectiveShowComparison,
  loading,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        {/* Brand mark (place ScaleAble_Logo1.svg in /public) */}
        <img
          src="/ScaleAble_Logo1.svg"
          alt="ScaleAble"
          className="h-10-auto max-w-[220px] object-contain"
        />
        <div className="sr-only text-xl font-semibold text-slate-900">ScaleAble</div>
      </div>
      <div className="mt-1 text-s text-slate-500">Client Portal</div>

      <nav className="mt-8 space-y-1">
        <NavItem href="/" active={pathname === "/"} label="Dashboard" />
        <NavItem href="/settings" active={pathname?.startsWith("/settings")} label="Settings" />
      </nav>

      {/* Data health panel */}
      <div className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Data health</div>
          <span className={["rounded-full px-2 py-0.5 text-[11px] font-semibold", conf.tone].join(" ")}>
            {comparisonEnabled ? `Compare: ${conf.label}` : "Compare: Off"}
          </span>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Last Shopify day: <span className="font-semibold text-slate-700">{lastSalesDateISO || "—"}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="text-[11px] text-slate-500">Primary missing</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">
              Shopify {dataHealth.missingShopify} • Ads {dataHealth.missingAds}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="text-[11px] text-slate-500">Compare missing</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">
              Shopify {comparisonEnabled ? dataHealth.missingCompareShopify : "—"} • Ads{" "}
              {comparisonEnabled ? dataHealth.missingCompareAds : "—"}
            </div>
          </div>
        </div>

        {comparisonEnabled && !comparisonAvailable && compareDisabledReason ? (
          <div className="mt-2 text-[11px] text-amber-700">Comparison hidden: {compareDisabledReason}</div>
        ) : null}
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