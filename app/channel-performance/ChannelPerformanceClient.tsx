"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format, subDays } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import { getContextValueClient } from "@/lib/shopifyContext";
import ScatterCorrelationChart from "@/components/ScatterCorrelationChart";
import { MultiSeriesEventfulLineChart } from "@/app/page.client";

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

function buildDateRangeRows(startISO: string, endISO: string, byDate: Record<string, ChannelRow>): ChannelRow[] {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const rows: ChannelRow[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const existing = byDate[date];
    if (existing) {
      rows.push(existing);
      continue;
    }

    rows.push({
      date,
      ts: new Date(`${date}T00:00:00Z`).getTime(),
      organic: 0,
      direct: 0,
      paid: 0,
      unknown: 0,
      ad_spend: 0,
    });
  }

  return rows;
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

function applyRollingScatterWindow(
  data: Array<{ date: string; adSpend: number; revenue: number }>,
  windowDays: number
) {
  return data.map((row, i) => {
    const slice = data.slice(Math.max(0, i - windowDays + 1), i + 1);
    const avgSpend = slice.reduce((a, b) => a + Number(b.adSpend || 0), 0) / Math.max(1, slice.length);
    const avgRevenue = slice.reduce((a, b) => a + Number(b.revenue || 0), 0) / Math.max(1, slice.length);
    return {
      date: row.date,
      adSpend: avgSpend,
      revenue: avgRevenue,
    };
  });
}

function calculateCorrelation<T extends Record<string, any>>(data: T[], xKey: keyof T, yKey: keyof T): number {
  const rows = (data || []).filter(
    (r) => Number.isFinite(Number(r?.[xKey])) && Number.isFinite(Number(r?.[yKey]))
  );
  const n = rows.length;
  if (n < 2) return 0;

  const sumX = rows.reduce((a, b) => a + Number(b[xKey] || 0), 0);
  const sumY = rows.reduce((a, b) => a + Number(b[yKey] || 0), 0);
  const sumXY = rows.reduce((a, b) => a + Number(b[xKey] || 0) * Number(b[yKey] || 0), 0);
  const sumX2 = rows.reduce((a, b) => a + Number(b[xKey] || 0) ** 2, 0);
  const sumY2 = rows.reduce((a, b) => a + Number(b[yKey] || 0) ** 2, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  if (!Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
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
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_12px_35px_-20px_rgba(15,23,42,0.35)] backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{
            color: channelColor,
            backgroundColor: `${channelColor}1A`,
            border: `1px solid ${channelColor}40`,
          }}
        >
          Revenue Signal
        </span>
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
        xAxisDataKey="date"
      />
    </section>
  );
}

export default function ChannelPerformanceClient() {
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

  const initialRange = useMemo(() => {
    const { startISO, endISO } = last30DaysRange();
    const endISO90 = format(new Date(), "yyyy-MM-dd");
    const startISO90 = format(subDays(new Date(), 89), "yyyy-MM-dd");
    return { mode: "preset", preset: "last90days", startISO: startISO90, endISO: endISO90 } as RangeValue;
  }, []);

  const [rangeValue, setRangeValue] = useState<RangeValue>(initialRange);
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [rollingEnabled, setRollingEnabled] = useState(true);
  const [rollingWindowDays, setRollingWindowDays] = useState<number>(14);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const effectiveShopDomain = (resolvedShopDomain || shopDomain || "").trim().toLowerCase();
        const effectiveClientId = (contextClientId || "").trim();
        if (!effectiveShopDomain && !effectiveClientId) {
          console.warn("[channel-performance] Missing shop domain/client_id in URL/session context. Skipping API request.");
          if (!cancelled) {
            setError("Missing shop domain/client_id in URL or session context");
            setLoading(false);
          }
          return;
        }

        const params = new URLSearchParams({
          start: rangeValue.startISO,
          end: rangeValue.endISO,
        });
        if (effectiveShopDomain) {
          params.set("shop_domain", effectiveShopDomain);
        } else {
          params.set("client_id", effectiveClientId);
        }
        const res = await authenticatedFetch(`/api/data/channel-performance?${params.toString()}`);
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error((json as any)?.error || `Request failed (${res.status})`);
        }

        const data = Array.isArray(json) ? json : [];
        const byDate: Record<string, ChannelRow> = {};

        for (const r of data) {
          const date = String(r?.date || "").trim();
          if (!date) continue;

          const ts = Number(r?.ts || new Date(`${date}T00:00:00Z`).getTime() || 0);
          if (!Number.isFinite(ts)) continue;

          if (!byDate[date]) {
            byDate[date] = {
              date,
              ts,
              organic: 0,
              direct: 0,
              paid: 0,
              unknown: 0,
              ad_spend: 0,
            };
          }

          const row = byDate[date];
          const spend = Number(r?.ad_spend ?? r?.adSpend ?? 0) || 0;
          row.ad_spend = Math.max(row.ad_spend, spend);

          // Wide-format support
          row.organic += Number(r?.organic ?? 0) || 0;
          row.direct += Number(r?.direct ?? 0) || 0;
          row.paid += Number(r?.paid ?? 0) || 0;
          row.unknown += Number(r?.unknown ?? 0) || 0;

          // Tall-format support: { traffic_type, revenue }
          const trafficType = String(r?.traffic_type || r?.channel || "").trim().toLowerCase();
          const revenue = Number(r?.revenue ?? 0) || 0;
          if (trafficType === "organic") row.organic += revenue;
          if (trafficType === "direct") row.direct += revenue;
          if (trafficType === "paid") row.paid += revenue;
          if (trafficType === "unknown") row.unknown += revenue;
        }

        const normalized = Object.values(byDate)
          .sort((a, b) => a.ts - b.ts)
          .filter((r) => !!r.date && Number.isFinite(r.ts));

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
  }, [rangeValue, shopDomain, resolvedShopDomain, contextClientId]);

  const filteredObservedRows = useMemo(() => {
    const startDate = new Date(`${rangeValue.startISO}T00:00:00Z`);
    const endDate = new Date(`${rangeValue.endISO}T23:59:59.999Z`);

    return [...rows]
      .filter((row) => {
        const d = new Date(`${row.date}T00:00:00Z`);
        return d >= startDate && d <= endDate;
      })
      .sort((a, b) => new Date(`${a.date}T00:00:00Z`).getTime() - new Date(`${b.date}T00:00:00Z`).getTime());
  }, [rows, rangeValue.startISO, rangeValue.endISO]);

  const filteredRows = useMemo(() => {
    const byDate = filteredObservedRows.reduce<Record<string, ChannelRow>>((acc, row) => {
      acc[row.date] = row;
      return acc;
    }, {});

    return buildDateRangeRows(rangeValue.startISO, rangeValue.endISO, byDate);
  }, [filteredObservedRows, rangeValue.startISO, rangeValue.endISO]);

  const displayRows = useMemo(() => {
    if (!rollingEnabled) return filteredRows;

    const organicSmoothed = buildRollingAvgSeries(filteredRows, "organic", rollingWindowDays);
    const directSmoothed = buildRollingAvgSeries(organicSmoothed, "direct", rollingWindowDays);
    const paidSmoothed = buildRollingAvgSeries(directSmoothed, "paid", rollingWindowDays);
    const unknownSmoothed = buildRollingAvgSeries(paidSmoothed, "unknown", rollingWindowDays);
    return buildRollingAvgSeries(unknownSmoothed, "ad_spend", rollingWindowDays);
  }, [filteredRows, rollingEnabled, rollingWindowDays]);

  const organicScatterData = useMemo(() => {
    const base = filteredRows.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend || 0),
      revenue: Number(row.organic || 0),
    }));
    return rollingEnabled ? applyRollingScatterWindow(base, rollingWindowDays) : base;
  }, [filteredRows, rollingEnabled, rollingWindowDays]);
  const directScatterData = useMemo(() => {
    const base = filteredRows.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend || 0),
      revenue: Number(row.direct || 0),
    }));
    return rollingEnabled ? applyRollingScatterWindow(base, rollingWindowDays) : base;
  }, [filteredRows, rollingEnabled, rollingWindowDays]);
  const paidScatterData = useMemo(() => {
    const base = filteredRows.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend || 0),
      revenue: Number(row.paid || 0),
    }));
    return rollingEnabled ? applyRollingScatterWindow(base, rollingWindowDays) : base;
  }, [filteredRows, rollingEnabled, rollingWindowDays]);
  const unknownScatterData = useMemo(() => {
    const base = filteredRows.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend || 0),
      revenue: Number(row.unknown || 0),
    }));
    return rollingEnabled ? applyRollingScatterWindow(base, rollingWindowDays) : base;
  }, [filteredRows, rollingEnabled, rollingWindowDays]);

  const organicCorr = useMemo(() => calculateCorrelation(organicScatterData, "adSpend", "revenue"), [organicScatterData]);
  const directCorr = useMemo(() => calculateCorrelation(directScatterData, "adSpend", "revenue"), [directScatterData]);
  const paidCorr = useMemo(() => calculateCorrelation(paidScatterData, "adSpend", "revenue"), [paidScatterData]);
  const unknownCorr = useMemo(() => calculateCorrelation(unknownScatterData, "adSpend", "revenue"), [unknownScatterData]);

  const summary = useMemo(() => {
    const totals = filteredRows.reduce(
      (acc, row) => {
        acc.adSpend += Number(row.ad_spend || 0);
        acc.organic += Number(row.organic || 0);
        acc.direct += Number(row.direct || 0);
        acc.paid += Number(row.paid || 0);
        acc.unknown += Number(row.unknown || 0);
        return acc;
      },
      { adSpend: 0, organic: 0, direct: 0, paid: 0, unknown: 0 }
    );
    const totalRevenue = totals.organic + totals.direct + totals.paid + totals.unknown;
    const roas = totals.adSpend > 0 ? totalRevenue / totals.adSpend : 0;
    return {
      ...totals,
      totalRevenue,
      roas,
      days: filteredObservedRows.length,
    };
  }, [filteredObservedRows.length, filteredRows]);

  const strongestCorr = useMemo(() => {
    const entries = [
      { label: "Organic", value: organicCorr },
      { label: "Direct", value: directCorr },
      { label: "Paid", value: paidCorr },
      { label: "Unknown", value: unknownCorr },
    ];
    return entries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  }, [organicCorr, directCorr, paidCorr, unknownCorr]);

  return (
    <DashboardLayout>
      <div className="min-w-0 p-6 md:p-8">
        <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-900 p-6 text-white shadow-[0_24px_60px_-28px_rgba(2,6,23,0.9)] md:p-7">
          <div className="pointer-events-none absolute -top-24 -right-10 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-52 w-52 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                Revenue Intelligence
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white md:text-4xl">Channel Performance</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-200">
                Compare channel-level Shopify revenue against paid spend to spot where growth is efficient and where budget is leaking.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right">
              <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm">
                <div className="text-[11px] uppercase tracking-wide text-slate-300">Revenue</div>
                <div className="text-lg font-semibold text-white">{formatCurrency(summary.totalRevenue)}</div>
              </div>
              <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm">
                <div className="text-[11px] uppercase tracking-wide text-slate-300">ROAS</div>
                <div className="text-lg font-semibold text-white">{summary.roas.toFixed(2)}x</div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)]">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100">
              <input
                type="checkbox"
                checked={rollingEnabled}
                onChange={(e) => setRollingEnabled(e.target.checked)}
                className="h-3 w-3 rounded border-slate-300 bg-slate-100 text-slate-700 focus:ring-2 focus:ring-slate-500"
              />
              <span>Smoothing Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
              <span>Window</span>
              <select
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
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

            <div className="ml-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Strongest Signal:</span>{" "}
              {strongestCorr.label} ({strongestCorr.value.toFixed(2)})
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
        ) : null}

        {loading ? <div className="mt-4 text-sm text-slate-500">Loading…</div> : null}

        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Ad Spend</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.adSpend)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Organic Rev</div>
            <div className="mt-1 text-xl font-semibold text-emerald-700">{formatCurrency(summary.organic)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Direct Rev</div>
            <div className="mt-1 text-xl font-semibold text-slate-700">{formatCurrency(summary.direct)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Paid Rev</div>
            <div className="mt-1 text-xl font-semibold text-amber-600">{formatCurrency(summary.paid)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Observed Days</div>
            <div className="mt-1 text-xl font-semibold text-violet-700">{summary.days}</div>
          </div>
        </section>

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
          <p className="mt-1 text-sm text-slate-600">Each point represents one day. Trendline slope and correlation indicate channel sensitivity to spend.</p>

          <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]">
              <div className="mb-3 text-lg font-semibold text-slate-900">
                Organic <span className="mx-1 text-slate-400">|</span>
                <span className="text-sm font-medium text-slate-500">Correlation: {organicCorr.toFixed(2)}</span>
              </div>
              <ScatterCorrelationChart data={organicScatterData} />
            </section>

            <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]">
              <div className="mb-3 text-lg font-semibold text-slate-900">
                Direct <span className="mx-1 text-slate-400">|</span>
                <span className="text-sm font-medium text-slate-500">Correlation: {directCorr.toFixed(2)}</span>
              </div>
              <ScatterCorrelationChart data={directScatterData} />
            </section>

            <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]">
              <div className="mb-3 text-lg font-semibold text-slate-900">
                Paid <span className="mx-1 text-slate-400">|</span>
                <span className="text-sm font-medium text-slate-500">Correlation: {paidCorr.toFixed(2)}</span>
              </div>
              <ScatterCorrelationChart data={paidScatterData} />
            </section>

            <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]">
              <div className="mb-3 text-lg font-semibold text-slate-900">
                Unknown <span className="mx-1 text-slate-400">|</span>
                <span className="text-sm font-medium text-slate-500">Correlation: {unknownCorr.toFixed(2)}</span>
              </div>
              <ScatterCorrelationChart data={unknownScatterData} />
            </section>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
