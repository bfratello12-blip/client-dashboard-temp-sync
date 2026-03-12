"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import ScatterCorrelationChart from "@/components/ScatterCorrelationChart";
import { MultiSeriesEventfulLineChart } from "@/app/page.client";

export const dynamic = "force-dynamic";

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
  const revenueKey = `${channelKey}_revenue`;
  const chartData = useMemo(
    () =>
      data.map((row) => ({
        date: row.date,
        ad_spend: Number(row.ad_spend || 0),
        organic_revenue: Number(row.organic || 0),
        direct_revenue: Number(row.direct || 0),
        paid_revenue: Number(row.paid || 0),
        unknown_revenue: Number(row.unknown || 0),
      })),
    [data]
  );

  const series = useMemo(
    () => [
      {
        key: revenueKey,
        name: title.replace(" vs Ad Spend", ""),
        color: channelColor,
        yAxisId: "left" as const,
      },
      {
        key: "ad_spend",
        name: "Ad Spend",
        color: "#3b82f6",
        yAxisId: "right" as const,
      },
    ],
    [revenueKey, title, channelColor]
  );

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <MultiSeriesEventfulLineChart
        data={chartData as any}
        showComparison={false}
        series={series as any}
        yTooltipFormatter={formatCurrency}
        markers={[]}
        showMarkers={false}
        compareLabel=""
        height={300}
        hideAreaLegend
        dualYAxis
        leftYAxisLabel="Revenue"
        rightYAxisLabel="Ad Spend"
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

  const [rollingEnabled, setRollingEnabled] = useState(false);
  const [rollingWindowDays, setRollingWindowDays] = useState<number>(7);

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
            ts: Number(r?.ts || new Date(`${String(r?.date || "")}T00:00:00Z`).getTime() || 0),
            organic: Number(r?.organic || 0),
            direct: Number(r?.direct || 0),
            paid: Number(r?.paid || 0),
            unknown: Number(r?.unknown || 0),
            ad_spend: Number(r?.ad_spend ?? r?.adSpend ?? 0),
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

  const displayRows = useMemo(() => {
    if (!rollingEnabled) return rows;

    const organicSmoothed = buildRollingAvgSeries(rows, "organic", rollingWindowDays);
    const directSmoothed = buildRollingAvgSeries(organicSmoothed, "direct", rollingWindowDays);
    const paidSmoothed = buildRollingAvgSeries(directSmoothed, "paid", rollingWindowDays);
    const unknownSmoothed = buildRollingAvgSeries(paidSmoothed, "unknown", rollingWindowDays);
    return buildRollingAvgSeries(unknownSmoothed, "ad_spend", rollingWindowDays);
  }, [rows, rollingEnabled, rollingWindowDays]);

  const organicScatterData = useMemo(
    () => rows.map((row) => ({ date: row.date, adSpend: Number(row.ad_spend || 0), revenue: Number(row.organic || 0) })),
    [rows]
  );
  const directScatterData = useMemo(
    () => rows.map((row) => ({ date: row.date, adSpend: Number(row.ad_spend || 0), revenue: Number(row.direct || 0) })),
    [rows]
  );
  const paidScatterData = useMemo(
    () => rows.map((row) => ({ date: row.date, adSpend: Number(row.ad_spend || 0), revenue: Number(row.paid || 0) })),
    [rows]
  );
  const unknownScatterData = useMemo(
    () => rows.map((row) => ({ date: row.date, adSpend: Number(row.ad_spend || 0), revenue: Number(row.unknown || 0) })),
    [rows]
  );

  return (
    <DashboardLayout>
      <div className="p-6 md:p-8 min-w-0">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Performance</h1>
            <p className="mt-1 text-slate-600">Shopify revenue by traffic source compared to ad spend.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
            data={displayRows}
            channelKey="organic"
            channelColor="#16a34a"
          />
          <ChannelChart
            title="Direct Revenue vs Ad Spend"
            data={displayRows}
            channelKey="direct"
            channelColor="#64748b"
          />
          <ChannelChart
            title="Paid Revenue vs Ad Spend"
            data={displayRows}
            channelKey="paid"
            channelColor="#f59e0b"
          />
          <ChannelChart
            title="Unknown Revenue vs Ad Spend"
            data={displayRows}
            channelKey="unknown"
            channelColor="#a855f7"
          />
        </div>

        <section className="mt-8">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Spend vs Revenue Correlation</h2>
          <p className="mt-1 text-sm text-slate-600">Each point represents one day.</p>

          <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
              <div className="mb-3 text-lg font-semibold text-slate-900">Organic</div>
              <ScatterCorrelationChart data={organicScatterData} />
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
              <div className="mb-3 text-lg font-semibold text-slate-900">Direct</div>
              <ScatterCorrelationChart data={directScatterData} />
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
              <div className="mb-3 text-lg font-semibold text-slate-900">Paid</div>
              <ScatterCorrelationChart data={paidScatterData} />
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
              <div className="mb-3 text-lg font-semibold text-slate-900">Unknown</div>
              <ScatterCorrelationChart data={unknownScatterData} />
            </section>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
