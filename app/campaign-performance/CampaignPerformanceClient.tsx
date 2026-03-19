"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format, subDays } from "date-fns";
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
  profit: number;
  profit_margin_pct: number;
};

type SortKey = keyof CampaignRow;

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

function formatPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function getLabelForMetric(key: SortKey): string {
  const labels: Record<SortKey, string> = {
    campaign_name: "Campaign",
    campaign_id: "Campaign ID",
    source: "Source",
    days: "Days",
    spend: "Spend",
    revenue: "Revenue",
    clicks: "Clicks",
    impressions: "Impressions",
    conversions: "Conversions",
    conversion_value: "Conv. Value",
    roas: "ROAS",
    cpc: "CPC",
    ctr: "CTR (%)",
    profit: "Profit",
    profit_margin_pct: "Margin %",
  };
  return labels[key] || String(key);
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

function SourceBadge({ source }: { source: string }) {
  const bgColor =
    source === "google"
      ? "bg-blue-100 text-blue-800"
      : source === "meta"
        ? "bg-purple-100 text-purple-800"
        : "bg-slate-100 text-slate-800";

  const label = source === "google" ? "Google Ads" : source === "meta" ? "Meta" : source;

  return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${bgColor}`}>{label}</span>;
}

export default function CampaignPerformanceClient() {
  const searchParams = useSearchParams();
  const shopDomain = searchParams.get("shop_domain") || "";

  const [range, setRange] = useState<RangeValue | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");

  useEffect(() => {
    setRange(last30DaysRange());
  }, []);

  useEffect(() => {
    if (!range) return;

    const fetchCampaigns = async () => {
      setLoading(true);
      setError("");

      try {
        const url = new URL("/api/data/campaign-performance", window.location.origin);
        url.searchParams.set("start", range.startISO);
        url.searchParams.set("end", range.endISO);
        if (shopDomain) url.searchParams.set("shop_domain", shopDomain);
        if (sourceFilter) url.searchParams.set("source", sourceFilter);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || `Failed (${res.status})`);
        }

        setCampaigns(payload?.campaigns || []);
      } catch (e: any) {
        setError(e?.message || "Failed to load campaigns");
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, [range, shopDomain, sourceFilter]);

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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  if (!shopDomain) {
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
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Campaign Performance</h1>
          <p className="text-slate-600">
            Track performance metrics across all Google Ads and Meta campaigns
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {range && (
            <DateRangePicker
              value={range}
              onChange={setRange}
            />
          )}

          {sources.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => setSourceFilter("")}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                  sourceFilter === ""
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
              >
                All Sources
              </button>
              {sources.map((src) => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                    sourceFilter === src
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                  }`}
                >
                  {src === "google" ? "Google" : "Meta"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Campaign Table */}
        {!loading && sorted.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => toggleSort("campaign_name")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Campaign {sortKey === "campaign_name" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => toggleSort("source")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Source {sortKey === "source" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("spend")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Spend {sortKey === "spend" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("revenue")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Revenue {sortKey === "revenue" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("profit")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Profit {sortKey === "profit" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("roas")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        ROAS {sortKey === "roas" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("clicks")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        Clicks {sortKey === "clicks" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort("cpc")}
                        className="font-semibold text-slate-700 hover:text-slate-900 text-sm"
                      >
                        CPC {sortKey === "cpc" && (sortAsc ? "↑" : "↓")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr
                      key={`${row.campaign_id}|${row.source}`}
                      className="border-b border-slate-200 hover:bg-slate-50 transition"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {row.campaign_name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <SourceBadge source={row.source} />
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">
                        {formatCurrency(row.spend)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-medium ${
                        row.profit > 0 ? "text-green-700" : row.profit < 0 ? "text-red-700" : "text-slate-700"
                      }`}>
                        {formatCurrency(row.profit)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">
                        {row.roas.toFixed(2)}x
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">
                        {row.clicks.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">
                        {formatCurrencyDetail(row.cpc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && sorted.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-12 text-center">
            <p className="text-slate-600">No campaign data available for the selected date range</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
