"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import * as DashboardPageClient from "@/app/page.client";

export const dynamic = "force-dynamic";

const MultiSeriesEventfulLineChart = (DashboardPageClient as any).MultiSeriesEventfulLineChart as React.ComponentType<any>;

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

type ChannelRow = {
  date: string;
  ts: number;
  organic: number;
  direct: number;
  paid: number;
  unknown: number;
  ad_spend: number;
};

type SeriesKey = "organic" | "direct" | "paid" | "unknown";

type ChannelChartPoint = {
  date: string;
  adSpend: number;
  revenue: number;
};

function last30DaysRange() {
  const endISO = format(new Date(), "yyyy-MM-dd");
  const startISO = format(subDays(new Date(), 29), "yyyy-MM-dd");
  return { startISO, endISO };
}

function formatCurrency(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function buildRollingAvgSeries<T extends { date: string }>(
  rows: T[],
  key: keyof T,
  windowDays: number
): T[] {
  if (windowDays <= 1) return rows;
  return rows.map((row, idx) => {
    const from = Math.max(0, idx - windowDays + 1);
    const slice = rows.slice(from, idx + 1);
    const sum = slice.reduce((acc, r) => acc + (Number((r as any)[key]) || 0), 0);
    const avg = slice.length > 0 ? sum / slice.length : 0;
    return { ...(row as any), [key]: avg } as T;
  });
}

function ChannelChart({
  title,
  data,
  channelKey,
  channelColor,
}: {
  title: string;
  data: ChannelRow[];
  channelKey: SeriesKey;
  channelColor: string;
}) {
  const [rollingEnabled, setRollingEnabled] = useState(false);
  const [rollingWindowDays, setRollingWindowDays] = useState<number>(7);
  const [showAdSpend, setShowAdSpend] = useState(true);
  const [showRevenue, setShowRevenue] = useState(true);

  const mappedData = useMemo(() => {
    return data.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend || 0),
      revenue: Number(row[channelKey] || 0),
    })) as ChannelChartPoint[];
  }, [data, channelKey]);

  const chartData = useMemo(() => {
    if (!rollingEnabled) return mappedData;
    const adSpendSmoothed = buildRollingAvgSeries(mappedData, "adSpend", rollingWindowDays);
    return buildRollingAvgSeries(adSpendSmoothed, "revenue", rollingWindowDays);
  }, [mappedData, rollingEnabled, rollingWindowDays]);

  const chartSeries = useMemo(() => {
    const series: Array<{ key: string; name: string; color: string; strokeWidth?: number }> = [];
    if (showAdSpend) {
      series.push({ key: "adSpend", name: "Ad Spend", color: "#3b82f6", strokeWidth: 2.6 });
    }
    if (showRevenue) {
      series.push({ key: "revenue", name: title.replace(" vs Ad Spend", ""), color: channelColor, strokeWidth: 2.6 });
    }
    return series;
  }, [showAdSpend, showRevenue, title, channelColor]);

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600">
            Daily trend ({rollingEnabled ? `rolling ${rollingWindowDays}d` : "daily"})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
            <input
              type="checkbox"
              checked={rollingEnabled}
              onChange={(e) => setRollingEnabled(e.target.checked)}
              className="w-3 h-3 text-slate-600 bg-slate-100 border-slate-300 rounded focus:ring-slate-500 focus:ring-2"
            />
            <span className="text-slate-700">Rolling</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-500 text-xs">Window</span>
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              value={rollingWindowDays}
              onChange={(e) => setRollingWindowDays(Number(e.target.value))}
              disabled={!rollingEnabled}
            >
              <option value={3}>3d</option>
              <option value={7}>7d</option>
              <option value={14}>14d</option>
              <option value={30}>30d</option>
            </select>
          </label>
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
            <input
              type="checkbox"
              checked={showAdSpend}
              onChange={(e) => setShowAdSpend(e.target.checked)}
              className="w-3 h-3 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-slate-700">Ad Spend</span>
          </label>
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
            <input
              type="checkbox"
              checked={showRevenue}
              onChange={(e) => setShowRevenue(e.target.checked)}
              className="w-3 h-3 bg-slate-100 border-slate-300 rounded focus:ring-2"
              style={{ accentColor: channelColor }}
            />
            <span className="text-slate-700">{title.replace(" vs Ad Spend", "")}</span>
          </label>
        </div>
      </div>
      <MultiSeriesEventfulLineChart
        data={chartData}
        showComparison={false}
        series={chartSeries}
        yTooltipFormatter={formatCurrency}
        markers={[] as any}
        showMarkers={false}
        compareLabel=""
        height={300}
        hideAreaLegend
      />
    </section>
  );
}

export default function ChannelPerformancePage() {
  const initialRange = useMemo(() => {
    const { startISO, endISO } = last30DaysRange();
    return { mode: "preset", preset: "last30days", startISO, endISO } as RangeValue;
  }, []);

  const [rangeValue, setRangeValue] = useState<RangeValue>(initialRange);
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          start: rangeValue.startISO,
          end: rangeValue.endISO,
        });
        const res = await authenticatedFetch(`/api/data/channel-performance?${params.toString()}`);
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error((json as any)?.error || `Request failed (${res.status})`);
        }

        const data = Array.isArray(json) ? json : [];
        const normalized = data
          .map((r: any) => ({
            date: String(r?.date || ""),
            ts: Number(r?.ts || 0),
            organic: Number(r?.organic || 0),
            direct: Number(r?.direct || 0),
            paid: Number(r?.paid || 0),
            unknown: Number(r?.unknown || 0),
            ad_spend: Number(r?.adSpend ?? r?.ad_spend ?? 0),
          }))
          .map((r: ChannelRow) => ({
            ...r,
            ts: Number.isFinite(r.ts) && r.ts > 0 ? r.ts : new Date(`${r.date}T00:00:00Z`).getTime(),
          }))
          .filter((r: ChannelRow) => !!r.date && Number.isFinite(r.ts));

        if (!cancelled) setRows(normalized);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load channel performance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [rangeValue]);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-8 min-w-0">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Performance</h1>
            <p className="mt-1 text-slate-600">Shopify revenue by traffic source compared to ad spend.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker
              value={rangeValue}
              onChange={setRangeValue}
              availableMinISO={undefined}
              availableMaxISO={undefined}
            />
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
        ) : null}

        {loading ? <div className="mt-4 text-sm text-slate-500">Loading…</div> : null}

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChannelChart
            title="Organic Revenue vs Ad Spend"
            data={rows}
            channelKey="organic"
            channelColor="#16a34a"
          />
          <ChannelChart
            title="Direct Revenue vs Ad Spend"
            data={rows}
            channelKey="direct"
            channelColor="#64748b"
          />
          <ChannelChart
            title="Paid Revenue vs Ad Spend"
            data={rows}
            channelKey="paid"
            channelColor="#f59e0b"
          />
          <ChannelChart
            title="Unknown Revenue vs Ad Spend"
            data={rows}
            channelKey="unknown"
            channelColor="#a855f7"
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
