"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { differenceInCalendarDays, format, parseISO, subDays, subYears } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import { getContextValueClient } from "@/lib/shopifyContext";

type PresetKey =
  | "today"
  | "yesterday"
  | "last7days"
  | "last14days"
  | "last30days"
  | "last90days"
  | "monthToDate"
  | "lastMonth"
  | "yearToDate"
  | "last12months"
  | "allTime";

type RangeValue = { mode: "preset" | "custom"; preset?: PresetKey; startISO: string; endISO: string };

type CampaignRow = {
  campaign_id: string;
  campaign_name: string;
  source: string;
  days: number;
  spend: number;
  revenue: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  cpc: number;
  ctr: number;
};

type SortKey = keyof CampaignRow;

type CompareMode = "previous_period" | "previous_year";

type CompareDelta = {
  current: number;
  previous: number;
  pct: number | null;
};

function formatCurrency(n: number) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCurrencyDetail(n: number) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompact(n: number) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function last30DaysRange() {
  const endISO = format(new Date(), "yyyy-MM-dd");
  const startISO = format(subDays(new Date(), 29), "yyyy-MM-dd");
  return {
    mode: "preset" as const,
    preset: "last30days" as const,
    startISO,
    endISO,
  };
}

function getComparisonRange(range: RangeValue, compareMode: CompareMode) {
  const start = parseISO(range.startISO);
  const end = parseISO(range.endISO);

  if (compareMode === "previous_year") {
    return {
      startISO: format(subYears(start, 1), "yyyy-MM-dd"),
      endISO: format(subYears(end, 1), "yyyy-MM-dd"),
    };
  }

  const dayCount = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const prevEnd = subDays(start, 1);
  const prevStart = subDays(prevEnd, dayCount - 1);

  return {
    startISO: format(prevStart, "yyyy-MM-dd"),
    endISO: format(prevEnd, "yyyy-MM-dd"),
  };
}

function computePercentDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function formatPercentDelta(delta: number | null) {
  if (delta === null) return "n/a";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function SourceBadge({ source }: { source: string }) {
  const tone =
    source === "google"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : source === "meta"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  const label = source === "google" ? "Google Ads" : source === "meta" ? "Meta" : source;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export default function CampaignPerformanceClient() {
  const searchParams = useSearchParams();
  const shopDomain = (
    getContextValueClient(searchParams as any, "shop") ||
    getContextValueClient(searchParams as any, "shop_domain") ||
    ""
  )
    .trim()
    .toLowerCase();
  const contextClientId = getContextValueClient(searchParams as any, "client_id").trim();
  const [resolvedShopDomain, setResolvedShopDomain] = useState<string>(shopDomain);

  const [range, setRange] = useState<RangeValue | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [comparisonEnabled, setComparisonEnabled] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>("previous_period");
  const [comparisonCampaigns, setComparisonCampaigns] = useState<CampaignRow[]>([]);

  useEffect(() => {
    if (!shopDomain) return;
    setResolvedShopDomain(shopDomain);
  }, [shopDomain]);

  useEffect(() => {
    if (shopDomain || resolvedShopDomain || !contextClientId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/client/context?client_id=${encodeURIComponent(contextClientId)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        const recovered = String(json?.shop_domain || "").trim().toLowerCase();
        if (!cancelled && res.ok && json?.ok && recovered) {
          setResolvedShopDomain(recovered);
        }
      } catch {
        // no-op
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopDomain, resolvedShopDomain, contextClientId]);

  useEffect(() => {
    setRange(last30DaysRange());
  }, []);

  useEffect(() => {
    if (!range) return;

    const fetchCampaigns = async () => {
      setLoading(true);
      setError("");

      try {
        const effectiveShopDomain = (resolvedShopDomain || shopDomain || "").trim().toLowerCase();
        const effectiveClientId = contextClientId.trim();
        if (!effectiveShopDomain && !effectiveClientId) {
          setError("Missing shop domain/client_id in URL or session context");
          setCampaigns([]);
          return;
        }

        const params = new URLSearchParams();
        params.set("start", range.startISO);
        params.set("end", range.endISO);
        if (effectiveShopDomain) params.set("shop_domain", effectiveShopDomain);
        if (effectiveClientId) params.set("client_id", effectiveClientId);
        if (sourceFilter) params.set("source", sourceFilter);
        const comparisonRange = getComparisonRange(range, compareMode);

        const currentRequest = authenticatedFetch(`/api/data/campaign-performance?${params.toString()}`);
        const comparisonRequest = comparisonEnabled
          ? (() => {
              const comparisonParams = new URLSearchParams(params);
              comparisonParams.set("start", comparisonRange.startISO);
              comparisonParams.set("end", comparisonRange.endISO);
              return authenticatedFetch(`/api/data/campaign-performance?${comparisonParams.toString()}`);
            })()
          : null;

        const [res, comparisonRes] = await Promise.all([
          currentRequest,
          comparisonRequest ?? Promise.resolve(null),
        ]);

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || `Failed (${res.status})`);
        }

        setCampaigns(payload?.campaigns || []);

        if (comparisonEnabled && comparisonRes) {
          const comparisonPayload = await comparisonRes.json().catch(() => ({}));
          if (!comparisonRes.ok || !comparisonPayload?.ok) {
            throw new Error(comparisonPayload?.error || `Comparison failed (${comparisonRes.status})`);
          }
          setComparisonCampaigns(comparisonPayload?.campaigns || []);
        } else {
          setComparisonCampaigns([]);
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load campaigns");
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, [range, shopDomain, resolvedShopDomain, contextClientId, sourceFilter, comparisonEnabled, compareMode]);

  const sorted = useMemo(() => {
    const filtered = sourceFilter
      ? campaigns.filter((c) => c.source === sourceFilter)
      : campaigns;

    return [...filtered].sort((a, b) => {
      const aVal = Number(a[sortKey]) || 0;
      const bVal = Number(b[sortKey]) || 0;

      if (sortKey === "campaign_name" || sortKey === "campaign_id" || sortKey === "source") {
        const aStr = String(a[sortKey] || "");
        const bStr = String(b[sortKey] || "");
        return sortAsc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      }

      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [campaigns, sortKey, sortAsc, sourceFilter]);

  const sources = useMemo(() => {
    const set = new Set(campaigns.map((c) => c.source));
    return Array.from(set).sort();
  }, [campaigns]);

  const summary = useMemo(() => {
    const totalSpend = campaigns.reduce((acc, row) => acc + Number(row.spend || 0), 0);
    const totalRevenue = campaigns.reduce((acc, row) => acc + Number(row.revenue || 0), 0);
    const totalClicks = campaigns.reduce((acc, row) => acc + Number(row.clicks || 0), 0);
    const totalImpressions = campaigns.reduce((acc, row) => acc + Number(row.impressions || 0), 0);
    const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    return {
      campaigns: campaigns.length,
      totalSpend,
      totalRevenue,
      totalClicks,
      blendedRoas,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    };
  }, [campaigns]);

  const comparisonSummary = useMemo(() => {
    const totalSpend = comparisonCampaigns.reduce((acc, row) => acc + Number(row.spend || 0), 0);
    const totalRevenue = comparisonCampaigns.reduce((acc, row) => acc + Number(row.revenue || 0), 0);
    const totalConversions = comparisonCampaigns.reduce((acc, row) => acc + Number(row.conversions || 0), 0);
    const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    return {
      totalRevenue,
      totalConversions,
      blendedRoas,
    };
  }, [comparisonCampaigns]);

  const comparisonDeltas = useMemo(() => {
    if (!comparisonEnabled) return null;

    const currentRevenue = summary.totalRevenue;
    const currentConversions = campaigns.reduce((acc, row) => acc + Number(row.conversions || 0), 0);
    const currentRoas = summary.blendedRoas;

    const deltas: Record<"revenue" | "conversions" | "roas", CompareDelta> = {
      revenue: {
        current: currentRevenue,
        previous: comparisonSummary.totalRevenue,
        pct: computePercentDelta(currentRevenue, comparisonSummary.totalRevenue),
      },
      conversions: {
        current: currentConversions,
        previous: comparisonSummary.totalConversions,
        pct: computePercentDelta(currentConversions, comparisonSummary.totalConversions),
      },
      roas: {
        current: currentRoas,
        previous: comparisonSummary.blendedRoas,
        pct: computePercentDelta(currentRoas, comparisonSummary.blendedRoas),
      },
    };

    return deltas;
  }, [comparisonEnabled, campaigns, summary.totalRevenue, summary.blendedRoas, comparisonSummary]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  if (!resolvedShopDomain && !contextClientId) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-slate-600">Missing shop context</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="relative mx-auto flex max-w-[1440px] flex-col gap-6 px-6 py-8">
        <div className="pointer-events-none absolute -left-20 top-10 h-64 w-64 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 top-0 h-72 w-72 rounded-full bg-emerald-100/55 blur-3xl" />

        <header className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_64px_-34px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-cyan-300/30 to-transparent blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 left-1/4 h-40 w-40 rounded-full bg-gradient-to-br from-emerald-300/30 to-transparent blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                Growth Analytics
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Campaign Performance</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Performance trends by campaign, with platform-native revenue definitions for Google Ads and Meta.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Campaigns</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(summary.campaigns)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Spend</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.totalSpend)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Revenue</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.totalRevenue)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Blended ROAS</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{summary.blendedRoas.toFixed(2)}x</div>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.4)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {range ? (
              <DateRangePicker
                value={range}
                onChange={setRange}
                comparisonEnabled={comparisonEnabled}
                onComparisonEnabledChange={setComparisonEnabled}
                compareMode={compareMode}
                onCompareModeChange={setCompareMode}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSourceFilter("")}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  sourceFilter === ""
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                All Sources
              </button>
              {sources.map((src) => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    sourceFilter === src
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {src === "google" ? "Google" : "Meta"}
                </button>
              ))}
            </div>
          </div>

          {comparisonEnabled && comparisonDeltas ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Revenue change</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    (comparisonDeltas.revenue.pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {formatPercentDelta(comparisonDeltas.revenue.pct)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatCurrency(comparisonDeltas.revenue.current)} vs {formatCurrency(comparisonDeltas.revenue.previous)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Conversions change</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    (comparisonDeltas.conversions.pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {formatPercentDelta(comparisonDeltas.conversions.pct)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatCompact(comparisonDeltas.conversions.current)} vs {formatCompact(comparisonDeltas.conversions.previous)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">ROAS change</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    (comparisonDeltas.roas.pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {formatPercentDelta(comparisonDeltas.roas.pct)}
                </div>
                <div className="text-xs text-slate-500">
                  {comparisonDeltas.roas.current.toFixed(2)}x vs {comparisonDeltas.roas.previous.toFixed(2)}x
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/90 p-3 text-sm text-rose-800 shadow-sm">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-300 border-b-slate-800" />
          </div>
        ) : null}

        {!loading && sorted.length > 0 ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.4)]">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full">
                <thead>
                  <tr className="bg-slate-50/95 text-slate-700">
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("campaign_name")} className="transition hover:text-slate-900">
                        Campaign {sortKey === "campaign_name" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("source")} className="transition hover:text-slate-900">
                        Source {sortKey === "source" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("spend")} className="transition hover:text-slate-900">
                        Spend {sortKey === "spend" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("revenue")} className="transition hover:text-slate-900">
                        Revenue {sortKey === "revenue" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("roas")} className="transition hover:text-slate-900">
                        ROAS {sortKey === "roas" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("clicks")} className="transition hover:text-slate-900">
                        Clicks {sortKey === "clicks" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("impressions")} className="transition hover:text-slate-900">
                        Impressions {sortKey === "impressions" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("conversions")} className="transition hover:text-slate-900">
                        Conversions {sortKey === "conversions" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("ctr")} className="transition hover:text-slate-900">
                        CTR {sortKey === "ctr" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="sticky top-0 border-b border-slate-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      <button onClick={() => toggleSort("cpc")} className="transition hover:text-slate-900">
                        CPC {sortKey === "cpc" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr
                      key={`${row.campaign_id}|${row.source}`}
                      className="border-b border-slate-100/80 transition hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-slate-900">{row.campaign_name}</div>
                        <div className="text-xs text-slate-500">{row.campaign_id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <SourceBadge source={row.source} />
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-800">{formatCurrency(row.spend)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">{formatCurrency(row.revenue)}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{row.roas.toFixed(2)}x</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{formatCompact(row.clicks)}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{formatCompact(row.impressions)}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{formatCompact(row.conversions)}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{row.ctr.toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{formatCurrencyDetail(row.cpc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!loading && sorted.length === 0 ? (
          <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-12 text-center shadow-sm">
            <p className="text-slate-700">No campaign data available for the selected date range</p>
            <p className="mt-1 text-xs text-slate-500">Try widening the range or running Sync & Refresh from Settings.</p>
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
