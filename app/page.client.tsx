"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import DateRangePicker from "@/app/components/DateRangePicker";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
  ReferenceArea,
  CartesianGrid,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
export const dynamic = "force-dynamic";
function toISO10(d: any): string {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
/** -----------------------------
 *  Pagination Helper for Long Queries
 *  ----------------------------- */
async function supabaseFetchAll<T>(
  builderFactory: (from: number, to: number) => any,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  while (true) {
    const query = builderFactory(offset, offset + pageSize - 1);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Pagination error:", error);
      throw error;
    }
    if (!data || data.length === 0) {
      break;
    }
    allRows.push(...data);
    if (data.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return allRows;
}
/** -----------------------------
 *  Types
 *  ----------------------------- */
type PresetRangeKey = "7D" | "30D" | "90D";
type RangeKey = PresetRangeKey | "CUSTOM";
type CompareMode = "previous_period" | "previous_year" | "none";
type DailyMetricRow = {
  date: string; // YYYY-MM-DD
  client_id: string;
  source: "google" | "meta" | "shopify" | string;
  spend: number;
  revenue: number; // tracked ad revenue
  units: number;
  clicks: number;
  impressions: number;
  conversions: number;
  orders: number;
};
type SalesSummaryRow = {
  date: string; // YYYY-MM-DD
  client_id: string;
  revenue: number; // Shopify truth
  orders: number;
  units: number;
  aov: number;
  asp: number;
};
type ProfitSummaryRow = {
  date: string; // YYYY-MM-DD
  client_id: string;
  revenue: number;
  orders: number;
  units: number;
  paid_spend: number;
  mer: number | null;
  est_cogs: number | null;
  est_processing_fees: number | null;
  est_fulfillment_costs: number | null;
  est_other_variable_costs?: number | null;
  est_other_fixed_costs?: number | null;
  contribution_profit: number | null;
  profit_mer: number | null;
};
type EventRow = {
  id: string;
  client_id: string;
  event_date: string; // YYYY-MM-DD
  type: string;
  title: string;
  notes: string | null;
  impact_window_days: number | null;
  created_at?: string;
};
type EventMarker = {
  id: string;
  x: string; // ISO YYYY-MM-DD
  x2?: string; // ISO YYYY-MM-DD
  iso: string;
  title: string;
  type: string;
  notes: string | null;
  impact_window_days: number | null;
  ts?: number;
  ts2?: number;
};
type HoveredEvent = {
  marker: EventMarker;
  x: number;
  y: number;
} | null;
type WindowISO = { startISO: string; endISO: string; days: number };
type Windows = { primary: WindowISO; compare: WindowISO | null };
type AttributionWindowDays = 1 | 3 | 7 | 14;
type ClientCostSettings = {
  client_id: string;
  // Percent fields are stored as fractions (e.g. 0.36 = 36%)
  default_gross_margin_pct: number | null;
  avg_cogs_per_unit: number | null;
  processing_fee_pct: number | null;
  processing_fee_fixed: number | null;
  pick_pack_per_order: number | null;
  shipping_subsidy_per_order: number | null;
  materials_per_order: number | null;
  other_variable_pct_revenue: number | null;
  other_fixed_per_day: number | null;
  // Legacy / optional input used previously in the UI
  margin_after_costs_pct: number | null;
};
/** -----------------------------
 *  Formatting & Utils
 *  ----------------------------- */
const pieColors = ["#2563EB", "#7C3AED", "#06B6D4", "#10B981", "#F59E0B"];
function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function formatNumber(n: number) {
  return n.toLocaleString();
}
function formatPct(n: number) {
  return `${n.toFixed(2)}%`;
}
function formatSignedCurrency(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(n))}`;
}
function formatSignedNumber(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(Math.round(n)))}`;
}
function formatSignedPct(n: number) {
  if (!isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}
function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function mmdd(iso: string) {
  return (iso || "").slice(5);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function isoToTsUTC(iso: string) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}
function isoToLocalMidnightDate(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function addDaysLocal(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function addDaysISO(iso: string, daysToAdd: number) {
  const base = isoToLocalMidnightDate(iso);
  return toISODate(addDaysLocal(base, daysToAdd));
}
function addYearsISO(iso: string, yearsToAdd: number) {
  const d = isoToLocalMidnightDate(iso);
  d.setFullYear(d.getFullYear() + yearsToAdd);
  return toISODate(d);
}
function pctChange(curr: number, prev: number) {
  if (!isFinite(curr) || !isFinite(prev)) return 0;
  if (prev === 0) return curr === 0 ? 0 : 999;
  return ((curr - prev) / prev) * 100;
}
function minISO(a: string, b: string) {
  return a <= b ? a : b;
}
function maxISO(a: string, b: string) {
  return a >= b ? a : b;
}
function uniqDateCount(rows: { date: string }[]) {
  const s = new Set<string>();
  for (const r of rows) s.add(toISO10(r.date));
  return s.size;
}
function confidenceLabel(frac: number) {
  if (!isFinite(frac)) return { label: "Unknown", tone: "bg-slate-100 text-slate-700" };
  if (frac >= 0.95) return { label: "High", tone: "bg-emerald-50 text-emerald-800" };
  if (frac >= 0.7) return { label: "Medium", tone: "bg-amber-50 text-amber-800" };
  return { label: "Low", tone: "bg-rose-50 text-rose-800" };
}
function safeNumber(x: any) {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}
function getNum(row: any, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const v = row?.[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
function monthLabel(v: any): string {
  // Accepts "YYYY-MM", "YYYY-MM-DD", Date, or timestamp
  if (!v) return "";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}$/.test(v)) return v;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 7);
    // try parse
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
    return v;
  }
  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
  } catch {}
  return "";
}
function daysInclusive(startISO: string, endISO: string) {
  const s = isoToLocalMidnightDate(startISO);
  const e = isoToLocalMidnightDate(endISO);
  const diff = Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000));
  return Math.max(1, diff + 1);
}
function buildPrimaryWindowPreset(rangeDays: number, endISO?: string): WindowISO {
  const end = endISO ? isoToLocalMidnightDate(endISO) : new Date();
  end.setHours(0, 0, 0, 0);
  const start = addDaysLocal(end, -(rangeDays - 1));
  return { startISO: toISODate(start), endISO: toISODate(end), days: rangeDays };
}
function buildPrimaryWindowCustom(startISO: string, endISO: string): WindowISO {
  const s = startISO <= endISO ? startISO : endISO;
  const e = startISO <= endISO ? endISO : startISO;
  const days = daysInclusive(s, e);
  return { startISO: s, endISO: e, days };
}
function buildPrecedingWindow(anchorStartISO: string, days: number): WindowISO {
  const d = Math.max(1, Math.floor(days || 1));
  const endISO = addDaysISO(anchorStartISO, -1);
  const startISO = addDaysISO(endISO, -(d - 1));
  return { startISO, endISO, days: d };
}
function buildCompareWindow(primary: WindowISO, mode: CompareMode): WindowISO | null {
  if (mode === "none") return null;
  if (mode === "previous_year") {
    const startISO = addYearsISO(primary.startISO, -1);
    const endISO = addYearsISO(primary.endISO, -1);
    return { startISO, endISO, days: primary.days };
  }
  // previous period
  const primaryStart = isoToLocalMidnightDate(primary.startISO);
  const compareEnd = addDaysLocal(primaryStart, -1);
  const compareStart = addDaysLocal(compareEnd, -(primary.days - 1));
  return { startISO: toISODate(compareStart), endISO: toISODate(compareEnd), days: primary.days };
}
function buildEventDateFlags(primaryDates: string[], markers: EventMarker[]) {
  const flagged = new Set<string>();
  if (!primaryDates?.length || !markers?.length) return flagged;
  const windows = markers
    .map((m) => {
      const s = String(m.x).slice(0, 10);
      const e = (m.x2 ? String(m.x2) : s).slice(0, 10);
      return { s, e };
    })
    .filter((w) => w.s && w.e);
  for (const iso of primaryDates) {
    for (const w of windows) {
      if (iso >= w.s && iso <= w.e) {
        flagged.add(iso);
        break;
      }
    }
  }
  return flagged;
}
function sumSeriesByFlag<T extends { date: string }>(
  series: T[],
  key: keyof T,
  flagged: Set<string>,
  wantFlagged: boolean
) {
  let s = 0;
  for (const r of series) {
    const iso = toISO10(r.date);
    const isFlagged = flagged.has(iso);
    if (wantFlagged ? isFlagged : !isFlagged) {
      s += safeNumber((r as any)[key]);
    }
  }
  return s;
}
function eachDayISO(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  if (!startISO || !endISO) return out;
  const s = isoToLocalMidnightDate(startISO);
  const e = isoToLocalMidnightDate(endISO);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return out;
  const forward = s.getTime() <= e.getTime();
  const days = Math.abs(Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)));
  const first = forward ? s : e;
  for (let i = 0; i <= days; i++) {
    const d = addDaysLocal(first, i);
    out.push(toISODate(d));
  }
  return out;
}
function sumSalesRange(series: SalesSummaryRow[], startISO: string, endISO: string) {
  const byDate: Record<string, SalesSummaryRow> = {};
  for (const r of series) byDate[toISO10(r.date)] = r;
  let revenue = 0;
  let orders = 0;
  let units = 0;
  for (const iso of eachDayISO(startISO, endISO)) {
    const row = byDate[iso];
    revenue += Number(row?.revenue ?? 0);
    orders += Number(row?.orders ?? 0);
    units += Number(row?.units ?? 0);
  }
  const aov = orders > 0 ? revenue / orders : 0;
  const asp = units > 0 ? revenue / units : 0;
  return { revenue, orders, units, aov, asp };
}
function sumSpendRange(series: { date: string; spend: number }[], startISO: string, endISO: string) {
  const byDate: Record<string, number> = {};
  for (const r of series) byDate[toISO10(r.date)] = safeNumber(r.spend);
  let spend = 0;
  for (const iso of eachDayISO(startISO, endISO)) {
    spend += byDate[iso] ?? 0;
  }
  return spend;
}
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function jsonToCsv(obj: Record<string, any>) {
  // simple 2-col CSV: key,value (good enough for “lift summary export”)
  const rows: string[] = ["key,value"];
  const walk = (prefix: string, v: any) => {
    if (v == null) {
      rows.push(`${JSON.stringify(prefix)},${JSON.stringify("")}`);
      return;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k, vv] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, vv);
      return;
    }
    if (Array.isArray(v)) {
      rows.push(`${JSON.stringify(prefix)},${JSON.stringify(v.map(String).join(" | "))}`);
      return;
    }
    rows.push(`${JSON.stringify(prefix)},${JSON.stringify(String(v))}`);
  };
  walk("", obj);
  return rows.join("\n");
}
/** -----------------------------
 *  Charts
 *  ----------------------------- */
/** ✅ Dual tooltip: Primary + Compare + Delta */
function DualLineTooltip({
  active,
  label,
  yKey,
  primaryMap,
  compareMap,
  valueFormatter,
  showCompare,
  compareLabel,
}: {
  active?: boolean;
  label?: any;
  yKey: string;
  primaryMap: Map<number, any>;
  compareMap: Map<number, any>;
  valueFormatter: (v: number) => string;
  showCompare: boolean;
  compareLabel: string;
}) {
  if (!active || label == null) return null;
  const ts = Number(label);
  const primary = primaryMap.get(ts);
  const compare = compareMap.get(ts);
  const iso = new Date(ts).toISOString().slice(0, 10);
  const dateLabel = iso?.length === 10 ? `${mmdd(iso)} (${iso})` : String(label);
  const pVal = safeNumber(primary?.[yKey]);
  const cVal = safeNumber(compare?.[yKey]);
  const delta = pVal - cVal;
  const deltaPct = cVal === 0 ? (pVal === 0 ? 0 : 999) : ((pVal - cVal) / cVal) * 100;
  return (
    <div className="rounded-xl bg-slate-900 text-white shadow-xl ring-1 ring-white/10">
      <div className="px-3 py-2">
        <div className="text-xs text-slate-300">{dateLabel}</div>
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-slate-300">Primary</div>
            <div className="text-sm font-semibold">{valueFormatter(pVal)}</div>
          </div>
          {showCompare ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs text-slate-300">{compareLabel}</div>
                <div className="text-sm font-semibold text-slate-100">{valueFormatter(cVal)}</div>
              </div>
              <div className="mt-2 rounded-lg bg-white/10 px-2 py-1">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[11px] text-slate-300">Δ</div>
                  <div className="text-xs font-semibold">
                    {valueFormatter(delta)}{" "}
                    <span className="text-slate-300 font-medium">
                      ({deltaPct === 999 ? "↑" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`})
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
/** ✅ Event hover card */
function EventTooltipCard({
  hover,
  containerRef,
}: {
  hover: HoveredEvent;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    }
  }, [containerRef]);
  if (!hover) return null;
  const w = dimensions.width;
  const h = dimensions.height;
  const cardW = 300;
  const cardH = 140;
  const left = clamp(hover.x + 12, 8, Math.max(8, w - cardW - 8));
  const top = clamp(hover.y + 12, 8, Math.max(8, h - cardH - 8));
  const m = hover.marker;
  return (
    <div
      className="absolute z-20 rounded-xl bg-slate-900 text-white shadow-xl ring-1 ring-white/10"
      style={{ left, top, width: cardW }}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs text-slate-300">{m.iso}</div>
          <div className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-100">
            {m.type}
          </div>
        </div>
        <div className="mt-1 text-sm font-semibold leading-snug">{m.title}</div>
        {m.notes ? (
          <div className="mt-1 line-clamp-3 text-xs text-slate-200">{m.notes}</div>
        ) : (
          <div className="mt-1 text-xs text-slate-400">No notes</div>
        )}
        {m.impact_window_days ? (
          <div className="mt-2 text-[11px] text-slate-300">
            Impact window: <span className="font-semibold text-slate-100">{m.impact_window_days}d</span>
            {m.x2 ? <span className="text-slate-400"> • shaded on chart</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
/**
 * ✅ Eventful chart
 */
function EventfulLineChart({
  data,
  compareData,
  showComparison,
  yKey,
  yTooltipFormatter,
  markers,
  showMarkers,
  xDomain,
  compareLabel,
  height = 320,
}: {
  data: { date: string; [k: string]: any }[];
  compareData?: { date: string; [k: string]: any }[];
  showComparison: boolean;
  yKey: string;
  yTooltipFormatter: (v: number) => string;
  markers: EventMarker[];
  showMarkers: boolean;
  xDomain?: [number, number];
  compareLabel: string;
  height?: number;
}) {
  type ChartPoint = { date: string; ts: number; [k: string]: any };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoveredEvent>(null);
  const chartData = useMemo(() => {
    const withTs: ChartPoint[] = (data ?? []).map((d) => {
      const iso = toISO10(d.date);
      return { ...(d as any), date: iso, ts: isoToTsUTC(iso) };
    });
    withTs.sort((a, b) => Number(a.ts) - Number(b.ts));
    return withTs;
  }, [data]);
  const compareChartData = useMemo(() => {
    const withTs: ChartPoint[] = (compareData ?? []).map((d) => {
      const iso = toISO10(d.date);
      return { ...(d as any), date: iso, ts: isoToTsUTC(iso) };
    });
    withTs.sort((a, b) => Number(a.ts) - Number(b.ts));
    return withTs;
  }, [compareData]);
  const primaryMap = useMemo(() => {
    const m = new Map<number, any>();
    for (const r of chartData) m.set(Number(r.ts), r);
    return m;
  }, [chartData]);
  const compareMap = useMemo(() => {
    const m = new Map<number, any>();
    for (const r of compareChartData) m.set(Number(r.ts), r);
    return m;
  }, [compareChartData]);
  const domainSet = useMemo(() => new Set(chartData.map((d) => String(d.date))), [chartData]);
  const yDomain = useMemo(() => {
    const primaryVals = chartData.map((d) => Number(d?.[yKey] ?? 0));
    const compareVals = compareChartData.map((d) => Number(d?.[yKey] ?? 0));
    const all = [...primaryVals, ...compareVals].filter((v) => Number.isFinite(v));
    if (!all.length) return [0, 1] as [number, number];
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const span = Math.max(1e-6, max - min);
    const pad = Math.max(span * 0.08, max * 0.04);
    return [min - pad, max + pad] as [number, number];
  }, [chartData, compareChartData, yKey]);
  const inRangeMarkers = useMemo(() => {
    return (markers ?? [])
      .map((m) => {
        const x = String(m.x).slice(0, 10);
        const x2 = m.x2 ? String(m.x2).slice(0, 10) : undefined;
        return {
          ...m,
          x,
          x2,
          ts: isoToTsUTC(x),
          ts2: x2 ? isoToTsUTC(x2) : undefined,
        };
      })
      .filter((m) => domainSet.has(m.x));
  }, [markers, domainSet]);
  const yTop = useMemo(() => {
    const vals = chartData.map((d) => Number(d?.[yKey] ?? 0));
    const max = Math.max(0, ...vals);
    return max > 0 ? max : 1;
  }, [chartData, yKey]);
  const eventDotData = useMemo(() => {
    return (showMarkers ? inRangeMarkers : []).map((m) => ({
      ts: m.ts,
      y: yTop,
      marker: m,
    }));
  }, [showMarkers, inRangeMarkers, yTop]);
  const singleUid = useId();
  const singleGradId = useMemo(() => `line-stroke-${yKey}-${singleUid}`, [yKey, singleUid]);
  const singleCompareGradId = useMemo(() => `line-compare-stroke-${yKey}-${singleUid}`, [yKey, singleUid]);
  const setHoverFromClientXY = (marker: EventMarker, clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ marker, x: clientX - r.left, y: clientY - r.top });
  };
  const clearHover = () => setHover(null);
  useEffect(() => {
    if (!hover) return;
    const onScrollOrResize = () => setHover(null);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [hover]);
  return (
    <div
      ref={wrapRef}
      className="relative w-full min-w-0 min-h-0 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm"
      style={{ height: `${height}px`, minHeight: `${height}px` }}
      onMouseLeave={clearHover}
      onPointerLeave={clearHover}
    >
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_1px_1px,#e5e7eb_1px,transparent_0)] [background-size:22px_22px] opacity-40" />
      <SafeResponsiveContainer height={height} className="h-full w-full">
        <ComposedChart data={chartData} margin={{ top: 16, right: 24, left: 12, bottom: 12 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <defs>
            <radialGradient id="eventMarkerGradient" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="70%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#15803d" />
            </radialGradient>
            <linearGradient id={singleGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
              <stop offset="50%" stopColor="#2563eb" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity={1} />
            </linearGradient>
            <linearGradient id={`${singleGradId}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#2563eb" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={singleCompareGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#cbd5e1" stopOpacity={0.85} />
              <stop offset="50%" stopColor="#94a3b8" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#64748b" stopOpacity={0.9} />
            </linearGradient>
            <linearGradient id={`${singleCompareGradId}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.3} />
              <stop offset="50%" stopColor="#94a3b8" stopOpacity={0.1} />
              <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={xDomain ?? ["dataMin", "dataMax"]}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => mmdd(new Date(Number(v)).toISOString().slice(0, 10))}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis 
            tick={{ fontSize: 12 }} 
            domain={yDomain as any} 
            tickFormatter={(v) => {
              const n = Number(v);
              if (!isFinite(n)) return "";
              if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
              if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
              if (Math.abs(n) < 10) return n.toFixed(1);
              return Math.round(n).toString();
            }}
          />
          <Tooltip
            content={(p: any) => (
              <DualLineTooltip
                active={p.active}
                label={p.label}
                yKey={yKey}
                primaryMap={primaryMap}
                compareMap={compareMap}
                valueFormatter={yTooltipFormatter}
                showCompare={showComparison && compareChartData.length > 0}
                compareLabel={compareLabel}
              />
            )}
          />
          {/* shading */}
          {showMarkers &&
            inRangeMarkers.map((m) => {
              if (!m.ts2 || !m.x2) return null;
              if (!domainSet.has(m.x2)) return null;
              return (
                <ReferenceArea
                  key={`area-${m.id}`}
                  x1={m.ts}
                  x2={m.ts2}
                  ifOverflow="hidden"
                  fill="#94a3b8"
                  fillOpacity={0.08}
                />
              );
            })}
          {/* marker lines */}
          {showMarkers &&
            inRangeMarkers.map((m) => (
              <ReferenceLine
                key={`line-${m.id}`}
                x={m.ts}
                ifOverflow="hidden"
                stroke="#94a3b8"
                strokeDasharray="3 3"
                strokeWidth={1.5}
              />
            ))}
          {/* marker dots */}
          {showMarkers && (
            <Scatter
              data={eventDotData}
              dataKey="y"
              isAnimationActive={false}
              shape={(props: any) => {
                const { cx, cy, payload } = props;
                const marker = payload?.marker as EventMarker | undefined;
                if (!marker || typeof cx !== "number" || typeof cy !== "number") return <g />;
                return (
                  <g>
                    {/* Shadow/glow effect */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={8}
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth={0.5}
                      opacity={0.3}
                    />
                    {/* Main marker with gradient */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill="url(#eventMarkerGradient)"
                      stroke="#16a34a"
                      strokeWidth={1.5}
                      style={{ cursor: "pointer", filter: "drop-shadow(0 1px 2px rgba(34, 197, 94, 0.3))" }}
                      onMouseEnter={(e: any) => setHoverFromClientXY(marker, e.clientX, e.clientY)}
                      onMouseMove={(e: any) => setHoverFromClientXY(marker, e.clientX, e.clientY)}
                      onMouseLeave={clearHover}
                    />
                    {/* Inner highlight */}
                    <circle
                      cx={cx - 1.5}
                      cy={cy - 1.5}
                      r={2}
                      fill="#86efac"
                      opacity={0.8}
                    />
                  </g>
                );
              }}
            />
          )}
          {/* compare area fill */}
          {showComparison && compareChartData.length > 0 && (
            <Area
              type="linear"
              dataKey={yKey}
              fill={`url(#${singleCompareGradId}-fill)`}
              stroke="none"
              connectNulls
              isAnimationActive={false}
              fillOpacity={1}
            />
          )}
          {/* compare line (dashed) */}
          {showComparison && compareChartData.length > 0 && (
            <Line
              type="linear"
              dataKey={yKey}
              data={compareChartData as any}
              stroke={`url(#${singleCompareGradId})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              strokeDasharray="6 4"
              opacity={0.65}
            />
          )}
          {/* primary area fill */}
          <Area
            type="linear"
            dataKey={yKey}
            fill={`url(#${singleGradId}-fill)`}
            stroke="none"
            isAnimationActive={false}
            connectNulls
            fillOpacity={1}
          />
          {/* primary line */}
          <Line
            type="linear"
            dataKey={yKey}
            stroke={`url(#${singleGradId})`}
            strokeWidth={2.4}
            dot={false}
            connectNulls
            activeDot={{ r: 4, stroke: "#1d4ed8", strokeWidth: 2, fill: "#fff" }}
          />
        </ComposedChart>
      </SafeResponsiveContainer>
      <EventTooltipCard hover={hover} containerRef={wrapRef} />
    </div>
  );
}

function MultiSeriesEventfulLineChart({
  data,
  compareData,
  showComparison,
  series,
  yTooltipFormatter,
  markers,
  showMarkers,
  xDomain,
  compareLabel,
  height = 320,
}: {
  data: { date: string; [k: string]: any }[];
  compareData?: { date: string; [k: string]: any }[];
  showComparison: boolean;
  series: { key: string; name: string; color: string }[];
  yTooltipFormatter: (v: number) => string;
  markers: EventMarker[];
  showMarkers: boolean;
  xDomain?: [number, number];
  compareLabel: string;
  height?: number;
}) {
  type ChartPoint = { date: string; ts: number; [k: string]: any };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoveredEvent>(null);
  const multiUid = useId();

  const chartData = useMemo(() => {
    const withTs: ChartPoint[] = (data ?? []).map((d) => {
      const iso = toISO10(d.date);
      return { ...(d as any), date: iso, ts: isoToTsUTC(iso) };
    });
    withTs.sort((a, b) => Number(a.ts) - Number(b.ts));
    return withTs;
  }, [data]);

  const compareChartData = useMemo(() => {
    const withTs: ChartPoint[] = (compareData ?? []).map((d) => {
      const iso = toISO10(d.date);
      return { ...(d as any), date: iso, ts: isoToTsUTC(iso) };
    });
    withTs.sort((a, b) => Number(a.ts) - Number(b.ts));
    return withTs;
  }, [compareData]);

  const strokeIds = useMemo(() => {
    const map: Record<string, string> = {};
    series.forEach((s) => {
      map[s.key] = `line-stroke-${s.key}-${multiUid}`;
    });
    return map;
  }, [series, multiUid]);

  const domainSet = useMemo(() => new Set(chartData.map((d) => String(d.date))), [chartData]);

  const inRangeMarkers = useMemo(() => {
    return (markers ?? [])
      .map((m) => {
        const x = String(m.x).slice(0, 10);
        const x2 = m.x2 ? String(m.x2).slice(0, 10) : undefined;
        return {
          ...m,
          x,
          x2,
          ts: isoToTsUTC(x),
          ts2: x2 ? isoToTsUTC(x2) : undefined,
        };
      })
      .filter((m) => domainSet.has(m.x));
  }, [markers, domainSet]);

  const yTop = useMemo(() => {
    const allVals: number[] = [];
    for (const s of series) {
      const vals = chartData.map((d) => Number(d?.[s.key] ?? 0));
      allVals.push(...vals);
    }
    const max = Math.max(0, ...allVals);
    return max > 0 ? max : 1;
  }, [chartData, series]);
  const yDomain = useMemo(() => {
    const allVals: number[] = [];
    for (const s of series) {
      for (const d of chartData) allVals.push(Number(d?.[s.key] ?? 0));
      for (const d of compareChartData) allVals.push(Number(d?.[s.key] ?? 0));
    }
    const filtered = allVals.filter((v) => Number.isFinite(v));
    if (!filtered.length) return [0, 1] as [number, number];
    const min = Math.min(0, ...filtered);
    const max = Math.max(0, ...filtered);
    const span = Math.max(1e-6, max - min);
    const pad = Math.max(span * 0.08, max * 0.04);
    return [min - pad, max + pad] as [number, number];
  }, [chartData, compareChartData, series]);

  const eventDotData = useMemo(() => {
    return (showMarkers ? inRangeMarkers : []).map((m) => ({
      ts: m.ts,
      y: yTop,
      marker: m,
    }));
  }, [showMarkers, inRangeMarkers, yTop]);

  const clearHover = useCallback(() => setHover(null), []);

  const setHoverFromClientXY = useCallback((marker: EventMarker, clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ marker, x: clientX - r.left, y: clientY - r.top });
  }, []);

  useEffect(() => {
    if (!hover) return;
    const onScrollOrResize = () => setHover(null);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [hover]);
  return (
    <div
      ref={wrapRef}
      className="relative w-full min-w-0 min-h-0 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm"
      style={{ height: `${height}px`, minHeight: `${height}px` }}
      onMouseLeave={clearHover}
      onPointerLeave={clearHover}
    >
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_1px_1px,#e5e7eb_1px,transparent_0)] [background-size:22px_22px] opacity-40" />
      <SafeResponsiveContainer height={height} className="h-full w-full">
        <ComposedChart
          data={chartData}
          margin={{ top: 16, right: 24, left: 12, bottom: 12 }}
        >
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <defs>
            <radialGradient id="eventMarkerGradient" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="70%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#15803d" />
            </radialGradient>
            {series.map((s) => (
              <g key={`grads-${s.key}`}>
                <linearGradient id={strokeIds[s.key]} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                  <stop offset="50%" stopColor={s.color} stopOpacity={0.65} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={1} />
                </linearGradient>
                <linearGradient id={`${strokeIds[s.key]}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="50%" stopColor={s.color} stopOpacity={0.1} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              </g>
            ))}
          </defs>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={xDomain}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => mmdd(new Date(Number(v)).toISOString().slice(0, 10))}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis 
            tick={{ fontSize: 12 }} 
            domain={yDomain as any} 
            tickFormatter={(v) => {
              const n = Number(v);
              if (!isFinite(n)) return "";
              if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
              if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
              if (Math.abs(n) < 10) return n.toFixed(1);
              return Math.round(n).toString();
            }}
          />
          <Tooltip
            formatter={(v: any, name: any) => [yTooltipFormatter(Number(v)), String(name)]}
            labelFormatter={(label: any) => {
              const iso = new Date(Number(label)).toISOString().slice(0, 10);
              return `${mmdd(iso)} (${iso})`;
            }}
          />
          <Legend />
          {/* Event markers */}
          {eventDotData.map((dot, i) => {
            const cx = dot.ts;
            const cy = dot.y;
            const marker = dot.marker;
            return (
              <g key={i}>
                {/* Outer glow */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={8}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth={0.5}
                  opacity={0.3}
                />
                {/* Main marker with gradient */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="url(#eventMarkerGradient)"
                  stroke="#16a34a"
                  strokeWidth={1.5}
                  style={{ cursor: "pointer", filter: "drop-shadow(0 1px 2px rgba(34, 197, 94, 0.3))" }}
                  onMouseEnter={(e: any) => setHoverFromClientXY(marker, e.clientX, e.clientY)}
                  onMouseMove={(e: any) => setHoverFromClientXY(marker, e.clientX, e.clientY)}
                  onMouseLeave={clearHover}
                />
                {/* Inner highlight */}
                <circle
                  cx={cx - 1.5}
                  cy={cy - 1.5}
                  r={2}
                  fill="#86efac"
                  opacity={0.8}
                />
              </g>
            );
          })}
          {/* Compare area fills */}
          {showComparison && compareChartData.length > 0 && series.map((s) => (
            <Area
              key={`compare-area-${s.key}`}
              type="linear"
              dataKey={s.key}
              fill={`url(#${strokeIds[s.key]}-fill)`}
              stroke="none"
              connectNulls
              isAnimationActive={false}
              fillOpacity={1}
            />
          ))}
          {/* Compare lines (dashed) */}
          {showComparison && compareChartData.length > 0 && series.map((s) => (
            <Line
              key={`compare-${s.key}`}
              type="linear"
              dataKey={s.key}
              data={compareChartData as any}
              name={`${s.name} (${compareLabel})`}
              stroke={`url(#${strokeIds[s.key]})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              strokeDasharray="6 4"
              opacity={0.65}
            />
          ))}
          {/* Primary area fills */}
          {series.map((s) => (
            <Area
              key={`area-${s.key}`}
              type="linear"
              dataKey={s.key}
              fill={`url(#${strokeIds[s.key]}-fill)`}
              isAnimationActive={false}
              stroke="none"
              connectNulls
              fillOpacity={1}
            />
          ))}
          {/* Primary lines */}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={`url(#${strokeIds[s.key]})`}
              strokeWidth={2.4}
              dot={false}
              connectNulls
              activeDot={{ r: 4, stroke: s.color, strokeWidth: 2, fill: "#fff" }}
            />
          ))}
        </ComposedChart>
      </SafeResponsiveContainer>
      <EventTooltipCard hover={hover} containerRef={wrapRef} />
    </div>
  );
}

function ChartReadyWrapper({
  minHeight,
  className,
  children,
}: {
  minHeight: number | string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.width > 0 && rect.height > 0) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setReady(true);
          });
        });
      } else {
        setReady(false);
      }
    });
    ro.observe(ref.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const h = typeof minHeight === "number" ? `${minHeight}px` : minHeight;

  return (
    <div ref={ref} className={className} style={{ height: h, minHeight: h }}>
      {ready ? (
        <div className="h-full w-full">{children}</div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">Loading chart…</div>
      )}
    </div>
  );
}

function SafeResponsiveContainer({
  height,
  className,
  children,
}: {
  height: number | string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const h = typeof height === "number" ? `${height}px` : height;

  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      if (rect.width > 0 && rect.height > 0) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setReady(true);
          });
        });
      } else {
        setReady(false);
      }
    });
    ro.observe(ref.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={className} style={{ height: h, minHeight: h }}>
      {ready ? (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">Loading chart…</div>
      )}
    </div>
  );
}

/** -----------------------------
 *  Page
 *  ----------------------------- */
export default function Home({ initialClientId }: { initialClientId?: string }) {
  const router = useRouter();
  // 🔑 Shopify embedded check: session token ping
  useEffect(() => {
    authenticatedFetch("/api/shopify/session-check").catch(() => {});
  }, []);
  /** Hydration-safe "generated at" timestamp (avoid Date() in render) */
  const [generatedAtISO, setGeneratedAtISO] = useState<string>("");
  const [generatedAtLocal, setGeneratedAtLocal] = useState<string>("");
  useEffect(() => {
    const d = new Date();
    setGeneratedAtISO(d.toISOString());
    setGeneratedAtLocal(d.toLocaleString());
  }, []);
  // Load North Star preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dash.northstar.key");
      if (saved) setNorthStarKey(saved);
    } catch {}
  }, []);
  /** Range + custom picker */
  const [range, setRange] = useState<RangeKey>("90D");
  const [customStartISO, setCustomStartISO] = useState<string>("");
  const [customEndISO, setCustomEndISO] = useState<string>("");
  
  // New DateRangePicker value
  const [dateRangeValue, setDateRangeValue] = useState<{
    mode: "preset" | "custom";
    preset?: "today" | "yesterday" | "last7days" | "last14days" | "last30days" | "last90days" | "monthToDate" | "lastMonth" | "yearToDate" | "last12months" | "allTime";
    startISO: string;
    endISO: string;
  }>(() => {
    return {
      mode: "preset" as const,
      preset: "last90days" as const,
      startISO: "",
      endISO: ""
    };
  });

  // Handle DateRangePicker changes
  const handleDateRangeChange = useCallback((newValue: typeof dateRangeValue) => {
    setDateRangeValue(newValue);
    
    // Update old state
    if (newValue.mode === "preset") {
      const presetMap: Record<string, string> = {
        "last7days": "7D",
        "last30days": "30D",
        "last90days": "90D"
      };
      const oldPreset = presetMap[newValue.preset || ""] || "CUSTOM";
      if (oldPreset !== "CUSTOM") {
        setRange(oldPreset as RangeKey);
      } else {
        setRange("CUSTOM");
        setCustomStartISO(newValue.startISO);
        setCustomEndISO(newValue.endISO);
      }
    } else {
      setRange("CUSTOM");
      setCustomStartISO(newValue.startISO);
      setCustomEndISO(newValue.endISO);
    }
  }, []);
  // Initialize custom picker defaults on client to avoid SSR/client timezone mismatch
  useEffect(() => {
    if (customStartISO && customEndISO) return;
    const p = buildPrimaryWindowPreset(7);
    setCustomStartISO(p.startISO);
    setCustomEndISO(p.endISO);
  }, [customStartISO, customEndISO]);

  /** Compare */
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [compareModeSetting, setCompareModeSetting] = useState<Exclude<CompareMode, "none">>("previous_period");
  const [comparisonAvailable, setComparisonAvailable] = useState(true);
  // Always build the comparison window; only use it if enabled
  const compareMode: CompareMode = compareModeSetting;
  const effectiveShowComparison = comparisonEnabled && comparisonAvailable;
  // Persist comparison preferences (enabled + mode)
  useEffect(() => {
    try {
      const storedEnabled = localStorage.getItem("dash.compare.enabled");
      if (storedEnabled !== null) setComparisonEnabled(storedEnabled === "true");
      const storedMode = localStorage.getItem("dash.compare.mode");
      if (storedMode === "previous_period" || storedMode === "previous_year") {
        setCompareModeSetting(storedMode as Exclude<CompareMode, "none">);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("dash.compare.enabled", String(comparisonEnabled)); } catch {}
  }, [comparisonEnabled]);
  useEffect(() => {
    try { localStorage.setItem("dash.compare.mode", compareModeSetting); } catch {}
  }, [compareModeSetting]);
  /** Events list behavior */
  const [showEvents30, setShowEvents30] = useState(false);
  const [eventsPrimary, setEventsPrimary] = useState<EventRow[]>([]);
  const [events30, setEvents30] = useState<EventRow[]>([]);
  const [events30Count, setEvents30Count] = useState<number | null>(null);
  /** Lift focus */
  const [liftFocusEventId, setLiftFocusEventId] = useState<string | null>(null);
  const [showAdvancedLift, setShowAdvancedLift] = useState(false);
  /** Events: create/delete */
  const EVENT_TYPES = [
    "budget_change",
    "promo",
    "price_change",
    "site_change",
    "feed_change",
    "other",
  ] as const;
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState<string>("");
  const [newEventDate, setNewEventDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newEventType, setNewEventType] = useState<(typeof EVENT_TYPES)[number]>("other");
  const [newEventTitle, setNewEventTitle] = useState<string>("");
  const [newEventNotes, setNewEventNotes] = useState<string>("");
  const [newEventWindowDays, setNewEventWindowDays] = useState<string>("7");
  /** Attribution window controls */
  const [attribWindowDays, setAttribWindowDays] = useState<AttributionWindowDays>(7);
  /** MER rolling controls (for MER Trend chart smoothing) */
  const [merRollingEnabled, setMerRollingEnabled] = useState(true);
  const [merRollingWindowDays, setMerRollingWindowDays] = useState<number>(7);
  /** Rolling controls for other trend charts */
  const [profitRollingEnabled, setProfitRollingEnabled] = useState(false);
  const [profitRollingWindowDays, setProfitRollingWindowDays] = useState<number>(7);
  const [revenueRollingEnabled, setRevenueRollingEnabled] = useState(false);
  const [revenueRollingWindowDays, setRevenueRollingWindowDays] = useState<number>(7);
  const [aspRollingEnabled, setAspRollingEnabled] = useState(false);
  const [aspRollingWindowDays, setAspRollingWindowDays] = useState<number>(7);
  /** Spend chart checkboxes */
  const [showTotalSpend, setShowTotalSpend] = useState(true);
  const [showMetaSpend, setShowMetaSpend] = useState(false);
  const [showGoogleSpend, setShowGoogleSpend] = useState(false);
  /** Revenue chart checkboxes */
  const [showShopifyRevenue, setShowShopifyRevenue] = useState(true);
  const [showGoogleRevenue, setShowGoogleRevenue] = useState(false);
  const [showMetaRevenue, setShowMetaRevenue] = useState(false);
  const [coverage, setCoverage] = useState({
    primarySales: 0,
    compareSales: 0,
    primaryAds: 0,
    compareAds: 0,
  });
  const [compareDisabledReason, setCompareDisabledReason] = useState<string>("");
  /** UI state */
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState<string>("");
  const [clientId, setClientId] = useState<string>(initialClientId || "");
  const [metricDataCount, setMetricDataCount] = useState<number>(0);
  /** Monthly rollup table */
  type MonthlyRow = {
    month: string;
    shopifyRevenue: number;
    shopifyOrders: number;
    metaSpend: number;
    googleSpend: number;
    totalAdSpend: number;
    trueRoas: number | null;
    aov: number | null;
    cpo: number | null;
    profit: number | null;
  };
  const [monthlyMonths, setMonthlyMonths] = useState<number>(6);
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState<boolean>(false);
  const [monthlyError, setMonthlyError] = useState<string>("");
  // Monthly table heatmap styling (blue for performance, neutral for spend)
  const monthlyHeat = useMemo(() => {
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const toNum = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const keys = [
      "shopifyRevenue",
      "shopifyOrders",
      "metaSpend",
      "googleSpend",
      "totalAdSpend",
      "trueRoas",
      "aov",
      "cpo",
      "profit",
    ] as const;
    const stats: Record<string, { min: number; max: number }> = {};
    for (const k of keys) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const r of monthlyRows) {
        const v = toNum((r as any)[k]);
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      stats[k] = {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
      };
    }
    // Approx ScaleAble blues (keep consistent with logo feel)
    const perfRgb = { r: 59, g: 130, b: 246 }; // blue
    // Neutral gray for spend (not "good" or "bad")
    const neutralRgb = { r: 148, g: 163, b: 184 };
    const styleFor = (key: typeof keys[number], value: number | null) => {
      if (value == null) return undefined;
      const { min, max } = stats[key] || { min: 0, max: 0 };
      const denom = max - min;
      const t = denom === 0 ? 0 : clamp01((value - min) / denom);
      const isSpend = key === "metaSpend" || key === "googleSpend" || key === "totalAdSpend";
      const rgb = isSpend ? neutralRgb : perfRgb;
      // Alpha ramps
      const a = isSpend ? 0.10 + t * 0.32 : 0.06 + t * 0.34;
      return { backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})` } as const;
    };
    return { styleFor };
  }, [monthlyRows]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  /** Totals */
  const [adTotals, setAdTotals] = useState({
    spend: 0,
    revenue: 0,
    orders: 0,
    conversions: 0,
    clicks: 0,
    impressions: 0,
  });
  const [bizTotals, setBizTotals] = useState({
    revenue: 0,
    orders: 0,
    units: 0,
    aov: 0,
    asp: 0,
    daysLoaded: 0,
  });
  const [compareTotals, setCompareTotals] = useState({
    adSpend: 0,
    adRevenue: 0,
    adClicks: 0,
    adImpressions: 0,
    bizRevenue: 0,
    bizOrders: 0,
    bizUnits: 0,
  });
  /** North Star selection */
  const [northStarKey, setNorthStarKey] = useState<string>("Profit Return");
  /** Series */
  const [spendSeries, setSpendSeries] = useState<{ date: string; spend: number }[]>([]);
  const [metaSpendSeries, setMetaSpendSeries] = useState<{ date: string; spend: number }[]>([]);
  const [googleSpendSeries, setGoogleSpendSeries] = useState<{ date: string; spend: number }[]>([]);
  const [spendSeriesCompare, setSpendSeriesCompare] = useState<{ date: string; spend: number }[]>([]);
  const [metaSpendSeriesCompare, setMetaSpendSeriesCompare] = useState<{ date: string; spend: number }[]>([]);
  const [googleSpendSeriesCompare, setGoogleSpendSeriesCompare] = useState<{ date: string; spend: number }[]>([]);
  const [totalCostSeries, setTotalCostSeries] = useState<{ date: string; spend: number }[]>([]);
  const [totalCostSeriesCompare, setTotalCostSeriesCompare] = useState<{ date: string; spend: number }[]>([]);
  const [spendByChannel, setSpendByChannel] = useState<{ name: string; value: number }[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [googleRevenueSeries, setGoogleRevenueSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [metaRevenueSeries, setMetaRevenueSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [revenueSeriesCompare, setRevenueSeriesCompare] = useState<{ date: string; revenue: number }[]>([]);
  const [googleRevenueSeriesCompare, setGoogleRevenueSeriesCompare] = useState<{ date: string; revenue: number }[]>([]);
  const [metaRevenueSeriesCompare, setMetaRevenueSeriesCompare] = useState<{ date: string; revenue: number }[]>([]);
  const [aspSeries, setAspSeries] = useState<{ date: string; asp: number | null }[]>([]);
  const [aspSeriesCompare, setAspSeriesCompare] = useState<{ date: string; asp: number | null }[]>([]);
  const [merSeries, setMerSeries] = useState<{ date: string; mer: number }[]>([]);
  const [merSeriesCompare, setMerSeriesCompare] = useState<{ date: string; mer: number }[]>([]);
  /** Profitability (global assumptions) */
  const [profitTotals, setProfitTotals] = useState({
    paidSpend: 0,
    contributionProfit: 0,
    profitMer: 0,
    estCogs: 0,
    estProcessingFees: 0,
    estFulfillmentCosts: 0,
    estOtherVariableCosts: 0,
    estOtherFixedCosts: 0,
  });
  const [compareProfitTotals, setCompareProfitTotals] = useState({
    paidSpend: 0,
    contributionProfit: 0,
    profitMer: 0,
    estCogs: 0,
    estProcessingFees: 0,
    estFulfillmentCosts: 0,
    estOtherVariableCosts: 0,
    estOtherFixedCosts: 0,
  });
  // Client-provided blended margin (after costs, before ads). Stored in Supabase client_cost_settings.margin_after_costs_pct.
  const [marginAfterCostsPct, setMarginAfterCostsPct] = useState<number | null>(null);
  // Cost settings (editable in Settings section)
  const [costSettings, setCostSettings] = useState<ClientCostSettings | null>(null);
  const [costSettingsOpen, setCostSettingsOpen] = useState(false);
  const [costSettingsSaving, setCostSettingsSaving] = useState(false);
  const [costSettingsError, setCostSettingsError] = useState<string>("");
  const [costSettingsSaved, setCostSettingsSaved] = useState<string>("");
  const [profitMerSeries, setProfitMerSeries] = useState<{ date: string; profit_mer: number }[]>([]);
  const [profitMerSeriesCompare, setProfitMerSeriesCompare] = useState<{ date: string; profit_mer: number }[]>([]);
  const [contribProfitSeries, setContribProfitSeries] = useState<{ date: string; contribution_profit: number }[]>([]);
  const [contribProfitSeriesCompare, setContribProfitSeriesCompare] = useState<{ date: string; contribution_profit: number }[]>([]);
  // Sales rows for flexible slices (events focus, custom comparisons)
  const [salesSeries, setSalesSeries] = useState<SalesSummaryRow[]>([]);
  const [salesSeriesCompare, setSalesSeriesCompare] = useState<SalesSummaryRow[]>([]);
  /** Attribution series (MER vs ROAS windowed) */
  const [attribSeries, setAttribSeries] = useState<
    { date: string; mer_w: number; roas_w: number; spend: number; rev_total_w: number; rev_tracked_w: number }[]
  >([]);
  const [showEventMarkers, setShowEventMarkers] = useState(false);
  const [windowStartISO, setWindowStartISO] = useState<string>("");
  const [windowEndISO, setWindowEndISO] = useState<string>("");
  /** Data health */
  const [lastSalesDateISO, setLastSalesDateISO] = useState<string>("");
  /** Derived: rangeDays */
  const rangeDays = useMemo(() => {
    if (range === "CUSTOM") return daysInclusive(customStartISO, customEndISO);
    if (range === "7D") return 7;
    if (range === "30D") return 30;
    return 90;
  }, [range, customStartISO, customEndISO]);
  /** Derived: primary + compare windows */
  const windows = useMemo<Windows>(() => {
    const primary =
      range === "CUSTOM"
        ? buildPrimaryWindowCustom(customStartISO, customEndISO)
        : buildPrimaryWindowPreset(rangeDays, lastSalesDateISO || undefined);
    const compare = buildCompareWindow(primary, compareMode);
    return { primary, compare };
  }, [range, rangeDays, compareMode, customStartISO, customEndISO, lastSalesDateISO]);
  
  // Sync dateRangeValue with current range state
  useEffect(() => {
    const presetMap: Record<string, "today" | "yesterday" | "last7days" | "last14days" | "last30days" | "last90days" | "monthToDate" | "lastMonth" | "yearToDate" | "last12months" | "allTime"> = {
      "7D": "last7days",
      "30D": "last30days",
      "90D": "last90days"
    };
    
    if (range === "CUSTOM") {
      setDateRangeValue({
        mode: "custom",
        startISO: customStartISO,
        endISO: customEndISO
      });
    } else {
      const preset = presetMap[range];
      if (preset) {
        // Get the actual dates for the preset
        const rangeData = windows.primary;
        setDateRangeValue({
          mode: "preset",
          preset: preset,
          startISO: rangeData.startISO,
          endISO: rangeData.endISO
        });
      }
    }
  }, [range, customStartISO, customEndISO, windows.primary]);

  const xDomain = useMemo<[number, number]>(() => {
    return [isoToTsUTC(windows.primary.startISO), isoToTsUTC(windows.primary.endISO)];
  }, [windows]);
  /** Create an event (server API uses service role) */
  const createEvent = useCallback(async () => {
    if (!clientId) return;
    setEventError("");
    const title = newEventTitle.trim();
    if (!title) {
      setEventError("Title is required.");
      return;
    }
    const event_date = (newEventDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      setEventError("Date must be YYYY-MM-DD.");
      return;
    }
    let impact_window_days: number | null = null;
    const wd = newEventWindowDays.trim();
    if (wd) {
      const n = Number(wd);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        setEventError("Window days must be 0–365.");
        return;
      }
      impact_window_days = Math.round(n);
    }
    setEventSaving(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          event_date,
          type: newEventType,
          title,
          notes: newEventNotes.trim() ? newEventNotes.trim() : null,
          impact_window_days,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Failed to create event");
      }
      // reset + refresh
      setNewEventTitle("");
      setNewEventNotes("");
      setNewEventWindowDays("7");
      setEventFormOpen(false);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      console.error(e);
      setEventError(e?.message ?? "Failed to create event");
    } finally {
      setEventSaving(false);
    }
  }, [clientId, newEventDate, newEventNotes, newEventTitle, newEventType, newEventWindowDays]);
  /** Delete an event */
  const deleteEvent = useCallback(
    async (id: string) => {
      if (!clientId || !id) return;
      setEventError("");
      setEventSaving(true);
      try {
        const res = await fetch(`/api/events?id=${encodeURIComponent(id)}&client_id=${encodeURIComponent(clientId)}` , {
          method: "DELETE",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || "Failed to delete event");
        }
        setRefreshNonce((n) => n + 1);
      } catch (e: any) {
        console.error(e);
        setEventError(e?.message ?? "Failed to delete event");
      } finally {
        setEventSaving(false);
      }
    },
    [clientId]
  );
  /** Keep custom inputs in sync when clicking preset pills */
  useEffect(() => {
    if (range === "CUSTOM") return;
    const p = buildPrimaryWindowPreset(rangeDays, lastSalesDateISO || undefined);
    setCustomStartISO(p.startISO);
    setCustomEndISO(p.endISO);
  }, [range, rangeDays, lastSalesDateISO]);
  /** Auth gate */
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) router.replace("/login");
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) router.replace("/login");
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [router]);
  
  // --- Cost settings helpers ---
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
  const saveCostSettings = useCallback(async () => {
    if (!clientId) return;
    setCostSettingsSaving(true);
    setCostSettingsError("");
    setCostSettingsSaved("");
    try {
      const cs = costSettings || { client_id: clientId } as ClientCostSettings;
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
      const { error } = await supabase
        .from("client_cost_settings")
        .upsert(payload, { onConflict: "client_id" });
      if (error) throw error;
      // Update local margin state used in existing UI calcs
      setMarginAfterCostsPct(payload.margin_after_costs_pct ?? null);
      setCostSettings({ ...(cs as any), ...payload });
      setCostSettingsSaved("Saved. Recomputing profit…");
      // Recompute profit summary rows for the current window
      try {
        const primary = windows.primary;
        const compare = windows.compare;
        const startISO = compare ? minISO(primary.startISO, compare.startISO) : primary.startISO;
        const endISO = primary.endISO;
        await fetch(`/api/cron/rolling-30?start=${startISO}&end=${endISO}&fillZeros=1`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SYNC_TOKEN}` },
        });
      } catch (e) {
        // Even if recompute fails, the settings were saved
        console.error(e);
      }
      // Trigger data refetch
      setRefreshNonce((n) => n + 1);
      setCostSettingsSaved("Saved.");
    } catch (e: any) {
      console.error(e);
      setCostSettingsError(e?.message ?? "Failed to save settings");
    } finally {
      setCostSettingsSaving(false);
    }
  }, [clientId, costSettings, windows]);
  const updateCostSetting = useCallback(
    (key: keyof ClientCostSettings, raw: string) => {
      setCostSettingsError("");
      setCostSettingsSaved("");
      const nextVal = raw === "" ? null : Number(raw);
      setCostSettings((prev) => {
        const base: ClientCostSettings =
          (prev as any) ||
          ({
            client_id: clientId || "",
            default_gross_margin_pct: null,
            avg_cogs_per_unit: null,
            processing_fee_pct: null,
            processing_fee_fixed: null,
            pick_pack_per_order: null,
            shipping_subsidy_per_order: null,
            materials_per_order: null,
            other_variable_pct_revenue: null,
            other_fixed_per_day: null,
            margin_after_costs_pct: null,
          } as ClientCostSettings);
        return { ...base, [key]: nextVal } as any;
      });
    },
    [clientId]
  );
/** Load data */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.error(sessionErr);
        if (!cancelled) setLoading(false);
        return;
      }
      const userId = sessionData.session?.user?.id;
      let cid = initialClientId || "";
      if (!cid) {
        if (!userId) {
          if (!cancelled) setLoading(false);
          return;
        }
        const { data: mapping, error: mapErr } = await supabase
          .from("user_clients")
          .select("client_id")
          .eq("user_id", userId)
          .limit(1);
        if (mapErr) {
          console.error(mapErr);
          if (!cancelled) setLoading(false);
          return;
        }
        cid = (mapping?.[0]?.client_id as string | undefined) || "";
      }
      if (!cancelled) setClientId(cid || "");
      if (!cid) {
        if (!cancelled) {
          setClientName("Unassigned Client");
          setAdTotals({ spend: 0, revenue: 0, orders: 0, conversions: 0, clicks: 0, impressions: 0 });
          setBizTotals({ revenue: 0, orders: 0, units: 0, aov: 0, asp: 0, daysLoaded: 0 });
          setCompareTotals({ adSpend: 0, adRevenue: 0, adClicks: 0, adImpressions: 0, bizRevenue: 0, bizOrders: 0, bizUnits: 0 });
          setSpendSeries([]);
          setMetaSpendSeries([]);
          setGoogleSpendSeries([]);
          setSpendSeriesCompare([]);
          setMetaSpendSeriesCompare([]);
          setGoogleSpendSeriesCompare([]);
          setSpendByChannel([]);
          setRevenueSeries([]);
          setGoogleRevenueSeries([]);
          setMetaRevenueSeries([]);
          setRevenueSeriesCompare([]);
          setGoogleRevenueSeriesCompare([]);
          setMetaRevenueSeriesCompare([]);
          setAspSeries([]);
          setAspSeriesCompare([]);
          setMerSeries([]);
          setMerSeriesCompare([]);
          setProfitTotals({
            paidSpend: 0,
            contributionProfit: 0,
            profitMer: 0,
            estCogs: 0,
            estProcessingFees: 0,
            estFulfillmentCosts: 0,
            estOtherVariableCosts: 0,
            estOtherFixedCosts: 0,
          });
          setCompareProfitTotals({
            paidSpend: 0,
            contributionProfit: 0,
            profitMer: 0,
            estCogs: 0,
            estProcessingFees: 0,
            estFulfillmentCosts: 0,
            estOtherVariableCosts: 0,
            estOtherFixedCosts: 0,
          });
          setProfitMerSeries([]);
          setProfitMerSeriesCompare([]);
          setContribProfitSeries([]);
          setContribProfitSeriesCompare([]);
          setAttribSeries([]);
          setCoverage({ primarySales: 0, compareSales: 0, primaryAds: 0, compareAds: 0 });
          setCompareDisabledReason("");
          setComparisonAvailable(true);
          setEventsPrimary([]);
          setEvents30([]);
          setEvents30Count(null);
          setWindowStartISO("");
          setWindowEndISO("");
          setLastSalesDateISO("");
          setLoading(false);
        }
        return;
      }
      
      // Fetch cost settings (used for profitability + editable in Settings)
      try {
        const { data: csRow, error: csErr } = await supabase
          .from("client_cost_settings")
          .select(
            "client_id, default_gross_margin_pct, avg_cogs_per_unit, processing_fee_pct, processing_fee_fixed, pick_pack_per_order, shipping_subsidy_per_order, materials_per_order, other_variable_pct_revenue, other_fixed_per_day, margin_after_costs_pct"
          )
          .eq("client_id", cid)
          .limit(1);
        if (!csErr) {
          const row = (csRow?.[0] as any) || null;
          if (!cancelled) {
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
            setCostSettings(settings);
            // Backward compat: normalize margin_after_costs_pct for the existing UI calculations
            const raw = settings.margin_after_costs_pct;
            const n = raw == null ? null : Number(raw);
            const normalized = n == null || !isFinite(n) ? null : n > 1 ? n / 100 : n;
            setMarginAfterCostsPct(normalized);
          }
        } else {
          if (!cancelled) {
            setCostSettings({
              client_id: cid,
              default_gross_margin_pct: null,
              avg_cogs_per_unit: null,
              processing_fee_pct: null,
              processing_fee_fixed: null,
              pick_pack_per_order: null,
              shipping_subsidy_per_order: null,
              materials_per_order: null,
              other_variable_pct_revenue: null,
              other_fixed_per_day: null,
              margin_after_costs_pct: null,
            });
            setMarginAfterCostsPct(null);
          }
        }
      } catch {
        if (!cancelled) {
          setCostSettings(null);
          setMarginAfterCostsPct(null);
        }
      }
const { data: clientRow } = await supabase.from("clients").select("name").eq("id", cid).limit(1);
      if (!cancelled) setClientName(clientRow?.[0]?.name ?? "Client");
      const primary = windows.primary;
      const compare = windows.compare;
      if (!cancelled) {
        setWindowStartISO(primary.startISO);
        setWindowEndISO(primary.endISO);
      }
      // For custom ranges, fetch exactly the selected span to avoid row limits
      // For preset ranges, keep attribution buffers
      let fetchStartISO: string;
      let fetchEndISO: string;
      if (range === "CUSTOM") {
        // For custom ranges, fetch both PRIMARY and COMPARE spans (no attribution buffers)
        const primaryStart = primary.startISO;
        const primaryEnd = primary.endISO;
        const compareStart = compare ? compare.startISO : primary.startISO;
        const compareEnd = compare ? compare.endISO : primary.endISO;
        fetchStartISO = minISO(primaryStart, compareStart);
        fetchEndISO = maxISO(primaryEnd, compareEnd);
      } else {
        // Preset ranges with attribution buffers
        const maxAttrib = 14; // keep aligned with AttributionWindowDays union
        const fetchBufferDays = 120;
        const minStart = compare ? minISO(primary.startISO, compare.startISO) : primary.startISO;
        fetchStartISO = toISODate(addDaysLocal(isoToLocalMidnightDate(minStart), -fetchBufferDays));
        fetchEndISO = addDaysISO(primary.endISO, maxAttrib - 1); // forward buffer
      }
      const fetchEventsCountForLastNDays = async (days: number) => {
        const e = new Date();
        e.setHours(0, 0, 0, 0);
        const s = addDaysLocal(e, -(days - 1));
        const { count, error } = await supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("client_id", cid)
          .gte("event_date", toISODate(s))
          .lte("event_date", toISODate(e));
        if (error) {
          console.error(error);
          return null;
        }
        return typeof count === "number" ? count : 0;
      };
      let metricDataError: any = null;
      let metricData: DailyMetricRow[] = [];
      try {
        const dmParams = new URLSearchParams({
          client_id: cid,
          start: fetchStartISO,
          end: fetchEndISO,
        });
        const syncToken = process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
        const dmRes = await fetch(`/api/data/daily-metrics?${dmParams.toString()}`, {
          headers: syncToken ? { Authorization: `Bearer ${syncToken}` } : undefined,
        });
        const dmJson = await dmRes.json().catch(() => ({}));
        if (!dmRes.ok || !dmJson?.ok) {
          throw new Error(dmJson?.error || `daily-metrics fetch failed (${dmRes.status})`);
        }
        metricData = (dmJson?.rows || []) as DailyMetricRow[];
        if (!cancelled) setMetricDataCount(metricData.length);
      } catch (e: any) {
        metricDataError = e;
        throw e;
      }
      // ✅ Shopify truth: revenue, orders, units come from daily_metrics (source='shopify').
      const shopifyAgg = (metricData ?? [])
        .filter((r) => r.source === "shopify")
        .reduce<Record<string, SalesSummaryRow>>((acc, r) => {
          const iso = toISO10(r.date);
          if (!acc[iso]) {
            acc[iso] = { date: iso, client_id: r.client_id, revenue: 0, orders: 0, units: 0, aov: 0, asp: 0 };
          }
          acc[iso].revenue += Number(r.revenue ?? 0);
          acc[iso].orders += Number(r.orders ?? 0);
          acc[iso].units += Number(r.units ?? 0);
          return acc;
        }, {});
      const salesDataAll: SalesSummaryRow[] = Object.values(shopifyAgg)
        .map((r) => {
          const revenue = Number(r.revenue ?? 0);
          const orders = Number(r.orders ?? 0);
          const units = Number(r.units ?? 0);
          return {
            ...r,
            units,
            aov: orders > 0 ? revenue / orders : 0,
            asp: units > 0 ? revenue / units : 0,
          };
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      // ✅ Profit summary (view) — global cost assumptions + MER/profit MER
      const profitDataAll = await supabaseFetchAll<ProfitSummaryRow>(
        (from, to) => supabase
          .from("daily_profit_summary")
          .select("*")
          .eq("client_id", cid)
          .gte("date", fetchStartISO)
          .lte("date", fetchEndISO)
          .order("date", { ascending: true }),
        1000
      );
      // last sync date = most recent profit row with revenue/orders > 0 in the primary window
      const lastNonZeroProfit = [...(profitDataAll ?? [])]
        .reverse()
        .find((r) => {
          const iso = toISO10(r.date);
          const revenue = Number(r.revenue ?? 0);
          const orders = Number(r.orders ?? 0);
          return iso >= primary.startISO && iso <= primary.endISO && (revenue > 0 || orders > 0);
        });
      const lastISO = lastNonZeroProfit ? toISO10(lastNonZeroProfit.date) : "";
      if (!cancelled) setLastSalesDateISO(lastISO);
      /** PRIMARY range slices */
      const inPrimaryMetric = metricData.filter((r) => {
        const iso = toISO10(r.date);
        return iso >= primary.startISO && iso <= primary.endISO;
      });
      const inPrimaryProfit = profitDataAll.filter((r) => {
        const iso = toISO10(r.date);
        return iso >= primary.startISO && iso <= primary.endISO;
      });
      const toProfitSalesRow = (r: ProfitSummaryRow): SalesSummaryRow => {
        const revenue = Number(r.revenue ?? 0);
        const orders = Number(r.orders ?? 0);
        const units = Number(r.units ?? 0);
        return {
          date: toISO10(r.date),
          client_id: r.client_id,
          revenue,
          orders,
          units,
          aov: orders > 0 ? revenue / orders : 0,
          asp: units > 0 ? revenue / units : 0,
        };
      };
      const inPrimarySales = inPrimaryProfit.map(toProfitSalesRow);
      /** COMPARE slices */
      const rawInCompareMetric =
        compare === null
          ? []
          : metricData.filter((r) => {
              const iso = toISO10(r.date);
              return iso >= compare.startISO && iso <= compare.endISO;
            });
      const rawInCompareProfit =
        compare === null
          ? []
          : profitDataAll.filter((r) => {
              const iso = toISO10(r.date);
              return iso >= compare.startISO && iso <= compare.endISO;
            });
      const rawInCompareSales = compare === null ? [] : rawInCompareProfit.map(toProfitSalesRow);
      console.log("[debug] profit_summary primary/compare", {
        primaryCount: inPrimaryProfit.length,
        primaryFirst: inPrimaryProfit[0],
        compareCount: rawInCompareProfit.length,
        compareFirst: rawInCompareProfit[0],
      });
      const nextCoverage = {
        primarySales: inPrimarySales.length,
        compareSales: rawInCompareSales.length,
        primaryAds: uniqDateCount(inPrimaryMetric),
        compareAds: uniqDateCount(rawInCompareMetric),
      };
      // compare enable threshold
      const minDaysForCompare = Math.ceil(primary.days * 0.7);
      // For custom ranges, allow comparison even if data is incomplete; for presets, require 70% coverage
      const isCustomRange = range === "CUSTOM";
      const available = !!compare && (isCustomRange || nextCoverage.compareSales >= minDaysForCompare);
      if (!cancelled) {
        setCoverage(nextCoverage);
        setComparisonAvailable(available);
        // Auto-enable comparison for custom ranges if data is available
        if (isCustomRange && available) {
          setComparisonEnabled(true);
        }
        if (comparisonEnabled && !available) {
          setCompareDisabledReason(
            compare ? `Not enough prior Shopify history (${nextCoverage.compareSales}/${primary.days} days).` : "Comparison is off."
          );
        } else if (comparisonEnabled && isCustomRange && nextCoverage.compareSales < minDaysForCompare) {
          setCompareDisabledReason(
            `Note: Limited prior history (${nextCoverage.compareSales}/${primary.days} days). Comparison may be incomplete.`
          );
        } else {
          setCompareDisabledReason("");
        }
      }
      const inCompareMetric = available ? rawInCompareMetric : [];
      const inCompareSales = available ? rawInCompareSales : [];
      const inCompareProfit = available ? rawInCompareProfit : [];
      const effectiveCompareWindow = available ? compare : null;
      /** Build maps for PRIMARY dates (spend, tracked revenue, total revenue, asp) */
      const spendByDatePrimary: Record<string, number> = {};
      const metaSpendByDatePrimary: Record<string, number> = {};
      const googleSpendByDatePrimary: Record<string, number> = {};
      const trackedRevByDatePrimary: Record<string, number> = {};
      const googleRevByDatePrimary: Record<string, number> = {};
      const metaRevByDatePrimary: Record<string, number> = {};
      for (const r of metricData) {
        const iso = toISO10(r.date);
        if (iso < primary.startISO || iso > primary.endISO) continue;
        const spend = Number(r.spend || 0);
        const revenue = Number(r.revenue || 0);
        if (r.source === "meta") {
          metaSpendByDatePrimary[iso] = (metaSpendByDatePrimary[iso] || 0) + spend;
          trackedRevByDatePrimary[iso] = (trackedRevByDatePrimary[iso] || 0) + revenue;
          metaRevByDatePrimary[iso] = (metaRevByDatePrimary[iso] || 0) + revenue;
        } else if (r.source === "google") {
          googleSpendByDatePrimary[iso] = (googleSpendByDatePrimary[iso] || 0) + spend;
          trackedRevByDatePrimary[iso] = (trackedRevByDatePrimary[iso] || 0) + revenue;
          googleRevByDatePrimary[iso] = (googleRevByDatePrimary[iso] || 0) + revenue;
        } else if (r.source === "shopify") {
          // Shopify rows are not part of ad spend; handled separately in Shopify truth sections.
        }
      }
      const revenueByDatePrimary: Record<string, number> = {};
      const aspByDatePrimary: Record<string, number | null> = {};
      const unitsByDatePrimary: Record<string, number> = {};
      const ordersByDatePrimary: Record<string, number> = {};
      for (const r of profitDataAll) {
        const iso = toISO10(r.date);
        if (iso < primary.startISO || iso > primary.endISO) continue;
        const revenue = Number((r as any).revenue || 0);
        const units = Number((r as any).units || 0);
        const orders = Number((r as any).orders || 0);
        revenueByDatePrimary[iso] = revenue;
        unitsByDatePrimary[iso] = units;
        ordersByDatePrimary[iso] = orders;
        aspByDatePrimary[iso] = units > 0 ? revenue / units : null;
        spendByDatePrimary[iso] = Number((r as any).paid_spend || 0);
      }
      /** PRIMARY totals */
      const adAgg = inPrimaryMetric.reduce(
        (acc, r) => {
          acc.revenue += Number(r.revenue || 0);
          acc.orders += Number(r.orders || 0);
          acc.conversions += Number(r.conversions || 0);
          acc.clicks += Number(r.clicks || 0);
          acc.impressions += Number(r.impressions || 0);
          return acc;
        },
        { spend: 0, revenue: 0, orders: 0, conversions: 0, clicks: 0, impressions: 0 }
      );
      adAgg.spend = inPrimaryProfit.reduce((s, r) => s + Number(r.paid_spend || 0), 0);
      let bizRevenue = 0;
      for (let d = primary.startISO; d <= primary.endISO; d = addDaysISO(d, 1)) {
        bizRevenue += Number(revenueByDatePrimary[d] || 0);
      }
      const bizOrders = inPrimarySales.reduce((s, r) => s + Number(r.orders || 0), 0);
      const bizUnits = inPrimarySales.reduce((s, r) => s + Number(r.units || 0), 0);
      const bizAov = bizOrders > 0 ? bizRevenue / bizOrders : 0;
      const shopifyRevenuePrimary = inPrimarySales.reduce((s, r) => s + Number(r.revenue || 0), 0);
      const bizAsp = bizUnits > 0 ? shopifyRevenuePrimary / bizUnits : 0;
      /** Profit totals (PRIMARY + COMPARE) */
      const profitPrimaryAgg = inPrimaryProfit.reduce(
        (acc, r) => {
          acc.paidSpend += Number(r.paid_spend || 0);
          acc.contributionProfit += Number(r.contribution_profit || 0);
          acc.estCogs += Number(r.est_cogs || 0);
          acc.estProcessingFees += Number(r.est_processing_fees || 0);
          acc.estFulfillmentCosts += Number(r.est_fulfillment_costs || 0);
          acc.estOtherVariableCosts += Number(r.est_other_variable_costs || 0);
          acc.estOtherFixedCosts += Number(r.est_other_fixed_costs || 0);
          return acc;
        },
        {
          paidSpend: 0,
          contributionProfit: 0,
          estCogs: 0,
          estProcessingFees: 0,
          estFulfillmentCosts: 0,
          estOtherVariableCosts: 0,
          estOtherFixedCosts: 0,
        }
      );
      const profitPrimaryMer =
        profitPrimaryAgg.paidSpend > 0 ? profitPrimaryAgg.contributionProfit / profitPrimaryAgg.paidSpend : 0;
      const profitCompareAgg = inCompareProfit.reduce(
        (acc, r) => {
          acc.paidSpend += Number(r.paid_spend || 0);
          acc.contributionProfit += Number(r.contribution_profit || 0);
          acc.estCogs += Number(r.est_cogs || 0);
          acc.estProcessingFees += Number(r.est_processing_fees || 0);
          acc.estFulfillmentCosts += Number(r.est_fulfillment_costs || 0);
          acc.estOtherVariableCosts += Number(r.est_other_variable_costs || 0);
          acc.estOtherFixedCosts += Number(r.est_other_fixed_costs || 0);
          return acc;
        },
        {
          paidSpend: 0,
          contributionProfit: 0,
          estCogs: 0,
          estProcessingFees: 0,
          estFulfillmentCosts: 0,
          estOtherVariableCosts: 0,
          estOtherFixedCosts: 0,
        }
      );
      const profitCompareMer =
        profitCompareAgg.paidSpend > 0 ? profitCompareAgg.contributionProfit / profitCompareAgg.paidSpend : 0;
      /** Profit maps (for series) */
      const profitMerByDate: Record<string, number> = {};
      const profitRowByDate: Record<string, any> = {};
      for (const r of profitDataAll) {
        const iso = toISO10(r.date);
        profitRowByDate[iso] = r;
        const pm = Number(r.profit_mer);
        profitMerByDate[iso] = Number.isFinite(pm) ? pm : 0;
      }
      const computeTotalCosts = (iso: string): number => {
        const row = profitRowByDate[iso];
        if (!row) return 0;
        return (
          Number(row.paid_spend || 0) +
          Number(row.est_cogs || 0) +
          Number(row.est_processing_fees || 0) +
          Number(row.est_fulfillment_costs || 0) +
          Number(row.est_other_variable_costs || 0) +
          Number(row.est_other_fixed_costs || 0)
        );
      };
      const computeContributionProfit = (iso: string): number => {
        const row = profitRowByDate[iso];
        if (!row) return 0;
        const cp = Number(row.contribution_profit);
        return Number.isFinite(cp) ? Number(cp.toFixed(2)) : 0;
      };
      /** PRIMARY series (forced full window) */
      const spendSeriesBuilt: { date: string; spend: number }[] = [];
      const metaSpendSeriesBuilt: { date: string; spend: number }[] = [];
      const googleSpendSeriesBuilt: { date: string; spend: number }[] = [];
      const totalCostSeriesBuilt: { date: string; spend: number }[] = [];
      const revenueSeriesBuilt: { date: string; revenue: number }[] = [];
      const googleRevenueSeriesBuilt: { date: string; revenue: number }[] = [];
      const metaRevenueSeriesBuilt: { date: string; revenue: number }[] = [];
      const aspSeriesBuilt: { date: string; asp: number | null }[] = [];
      const merSeriesBuilt: { date: string; mer: number }[] = [];
      const profitMerSeriesBuilt: { date: string; profit_mer: number }[] = [];
      const contribProfitSeriesBuilt: { date: string; contribution_profit: number }[] = [];
      {
        const d = isoToLocalMidnightDate(primary.startISO);
        for (let i = 0; i < primary.days; i++) {
          const iso = toISODate(d);
          const spend = Number(spendByDatePrimary[iso] || 0);
          const metaSpend = Number(metaSpendByDatePrimary[iso] || 0);
          const googleSpend = Number(googleSpendByDatePrimary[iso] || 0);
          const rev = Number(revenueByDatePrimary[iso] || 0);
          const googleRev = Number(googleRevByDatePrimary[iso] || 0);
          const metaRev = Number(metaRevByDatePrimary[iso] || 0);
          const aspRaw = aspByDatePrimary[iso];
          const asp = Number.isFinite(Number(aspRaw)) ? Number(aspRaw) : null;
          const mer = spend > 0 ? rev / spend : 0;
          const totalCosts = computeTotalCosts(iso);
          spendSeriesBuilt.push({ date: iso, spend });
          metaSpendSeriesBuilt.push({ date: iso, spend: metaSpend });
          googleSpendSeriesBuilt.push({ date: iso, spend: googleSpend });
          totalCostSeriesBuilt.push({ date: iso, spend: totalCosts });
          revenueSeriesBuilt.push({ date: iso, revenue: rev });
          googleRevenueSeriesBuilt.push({ date: iso, revenue: googleRev });
          metaRevenueSeriesBuilt.push({ date: iso, revenue: metaRev });
          aspSeriesBuilt.push({ date: iso, asp });
          merSeriesBuilt.push({ date: iso, mer: Number(mer.toFixed(2)) });
          const pm = Number(profitMerByDate[iso] || 0);
          const cp = computeContributionProfit(iso);
          profitMerSeriesBuilt.push({ date: iso, profit_mer: Number(pm.toFixed(2)) });
          contribProfitSeriesBuilt.push({ date: iso, contribution_profit: cp });
          d.setDate(d.getDate() + 1);
        }
      }
      /** COMPARE series (overlay-aligned to PRIMARY dates) */
      const spendSeriesCompareBuilt: { date: string; spend: number }[] = [];
      const metaSpendSeriesCompareBuilt: { date: string; spend: number }[] = [];
      const googleSpendSeriesCompareBuilt: { date: string; spend: number }[] = [];
      const totalCostSeriesCompareBuilt: { date: string; spend: number }[] = [];
      const revenueSeriesCompareBuilt: { date: string; revenue: number }[] = [];
      const googleRevenueSeriesCompareBuilt: { date: string; revenue: number }[] = [];
      const metaRevenueSeriesCompareBuilt: { date: string; revenue: number }[] = [];
      const aspSeriesCompareBuilt: { date: string; asp: number | null }[] = [];
      const merSeriesCompareBuilt: { date: string; mer: number }[] = [];
      const profitMerSeriesCompareBuilt: { date: string; profit_mer: number }[] = [];
      const contribProfitSeriesCompareBuilt: { date: string; contribution_profit: number }[] = [];
      let compareSpend = 0;
      let compareAdRevenue = 0;
      let compareClicks = 0;
      let compareImpressions = 0;
      let compareBizRevenue = 0;
      let compareBizOrders = 0;
      let compareBizUnits = 0;
      if (effectiveCompareWindow) {
        const spendByDateCompare: Record<string, number> = {};
        const metaSpendByDateCompare: Record<string, number> = {};
        const googleSpendByDateCompare: Record<string, number> = {};
        const trackedRevByDateCompare: Record<string, number> = {};
        const googleRevByDateCompare: Record<string, number> = {};
        const metaRevByDateCompare: Record<string, number> = {};
        for (const r of metricData) {
          const iso = toISO10(r.date);
          if (iso < effectiveCompareWindow.startISO || iso > effectiveCompareWindow.endISO) continue;
          const spend = Number(r.spend || 0);
          const revenue = Number(r.revenue || 0);
          if (r.source === "meta") {
            metaSpendByDateCompare[iso] = (metaSpendByDateCompare[iso] || 0) + spend;
            trackedRevByDateCompare[iso] = (trackedRevByDateCompare[iso] || 0) + revenue;
            metaRevByDateCompare[iso] = (metaRevByDateCompare[iso] || 0) + revenue;
          } else if (r.source === "google") {
            googleSpendByDateCompare[iso] = (googleSpendByDateCompare[iso] || 0) + spend;
            trackedRevByDateCompare[iso] = (trackedRevByDateCompare[iso] || 0) + revenue;
            googleRevByDateCompare[iso] = (googleRevByDateCompare[iso] || 0) + revenue;
          } else if (r.source === "shopify") {
            // Shopify rows are not part of ad spend; handled separately in Shopify truth sections.
          }
        }
        const revenueByDateCompare: Record<string, number> = {};
        const aspByDateCompare: Record<string, number | null> = {};
        // Profit series for compare window can reuse the same per-day profit maps we built above.
        for (const r of rawInCompareProfit) {
          const iso = toISO10(r.date);
          const revenue = Number((r as any).revenue || 0);
          const units = Number((r as any).units || 0);
          revenueByDateCompare[iso] = revenue;
          aspByDateCompare[iso] = units > 0 ? revenue / units : null;
          spendByDateCompare[iso] = Number((r as any).paid_spend || 0);
        }
        for (let i = 0; i < primary.days; i++) {
          const primaryISO = addDaysISO(primary.startISO, i);
          const compareISO = addDaysISO(effectiveCompareWindow.startISO, i);
          const spend = Number(spendByDateCompare[compareISO] || 0);
          const metaSpend = Number(metaSpendByDateCompare[compareISO] || 0);
          const googleSpend = Number(googleSpendByDateCompare[compareISO] || 0);
          const rev = Number(revenueByDateCompare[compareISO] || 0);
          const googleRev = Number(googleRevByDateCompare[compareISO] || 0);
          const metaRev = Number(metaRevByDateCompare[compareISO] || 0);
          const aspRaw = aspByDateCompare[compareISO];
          const asp = Number.isFinite(Number(aspRaw)) ? Number(aspRaw) : null;
          const mer = spend > 0 ? rev / spend : 0;
          const totalCosts = computeTotalCosts(compareISO);
          spendSeriesCompareBuilt.push({ date: primaryISO, spend });
          metaSpendSeriesCompareBuilt.push({ date: primaryISO, spend: metaSpend });
          googleSpendSeriesCompareBuilt.push({ date: primaryISO, spend: googleSpend });
          totalCostSeriesCompareBuilt.push({ date: primaryISO, spend: totalCosts });
          revenueSeriesCompareBuilt.push({ date: primaryISO, revenue: rev });
          googleRevenueSeriesCompareBuilt.push({ date: primaryISO, revenue: googleRev });
          metaRevenueSeriesCompareBuilt.push({ date: primaryISO, revenue: metaRev });
          aspSeriesCompareBuilt.push({ date: primaryISO, asp });
          merSeriesCompareBuilt.push({ date: primaryISO, mer: Number(mer.toFixed(2)) });
          const pm = Number(profitMerByDate[compareISO] || 0);
          const cp = computeContributionProfit(compareISO);
          profitMerSeriesCompareBuilt.push({ date: primaryISO, profit_mer: Number(pm.toFixed(2)) });
          contribProfitSeriesCompareBuilt.push({ date: primaryISO, contribution_profit: cp });
        }
        compareSpend = inCompareProfit.reduce((s, r) => s + Number(r.paid_spend || 0), 0);
        compareAdRevenue = inCompareMetric.reduce((s, r) => s + Number(r.revenue || 0), 0);
        compareClicks = inCompareMetric.reduce((s, r) => s + Number(r.clicks || 0), 0);
        compareImpressions = inCompareMetric.reduce((s, r) => s + Number(r.impressions || 0), 0);
        for (let d = effectiveCompareWindow.startISO; d <= effectiveCompareWindow.endISO; d = addDaysISO(d, 1)) {
          compareBizRevenue += Number(revenueByDateCompare[d] || 0);
        }
        compareBizOrders = inCompareSales.reduce((s, r) => s + Number(r.orders || 0), 0);
        compareBizUnits = inCompareSales.reduce((s, r) => s + Number(r.units || 0), 0);
        // (trackedRevByDateCompare used later in attribution section)
      }
      /** Events */
      const { data: eventRows, error: eventsErr } = await supabase
        .from("events")
        .select("id, client_id, event_date, type, title, notes, impact_window_days, created_at")
        .eq("client_id", cid)
        .gte("event_date", primary.startISO)
        .lte("event_date", primary.endISO)
        .order("event_date", { ascending: false });
      if (eventsErr) console.error(eventsErr);
      const primaryEventsData = (eventRows ?? []) as EventRow[];
      let count30: number | null = null;
      if (range === "7D") {
        count30 = await fetchEventsCountForLastNDays(30);
        if (showEvents30) {
          const e = new Date();
          e.setHours(0, 0, 0, 0);
          const s = addDaysLocal(e, -(30 - 1));
          const { data: rows30, error: err30 } = await supabase
            .from("events")
            .select("id, client_id, event_date, type, title, notes, impact_window_days, created_at")
            .eq("client_id", cid)
            .gte("event_date", toISODate(s))
            .lte("event_date", toISODate(e))
            .order("event_date", { ascending: false });
          if (err30) console.error(err30);
          if (!cancelled) setEvents30((rows30 ?? []) as EventRow[]);
        } else {
          if (!cancelled) setEvents30([]);
        }
      } else {
        if (!cancelled) setEvents30([]);
      }
      /** Attribution window (MER vs ROAS) — simple, client-friendly
       *  We compute:
       *   spendRange = sum spend[start..end]
       *   trackedRevWindow = sum tracked_rev[start..end+(w-1)]
       *   totalRevWindow = sum total_rev[start..end+(w-1)]
       *  and also a daily series that shows “forward window” revenue per day divided by that day’s spend.
       */
      const buildForwardSum = (dateToValue: Record<string, number>, startISO: string, days: number, window: number) => {
        // for each day i: sum value over [i .. i+window-1]
        const out: Record<string, number> = {};
        for (let i = 0; i < days; i++) {
          const iso = addDaysISO(startISO, i);
          let s = 0;
          for (let j = 0; j < window; j++) {
            const iso2 = addDaysISO(iso, j);
            s += Number(dateToValue[iso2] || 0);
          }
          out[iso] = s;
        }
        return out;
      };
      // tracked rev map for primary (already have by date within primary, but we need lookahead too)
      const trackedRevByDateAll: Record<string, number> = {};
      for (const r of metricData) {
        const iso = toISO10(r.date);
        trackedRevByDateAll[iso] = (trackedRevByDateAll[iso] || 0) + Number(r.revenue || 0);
      }
      const totalCostsByDateAll: Record<string, number> = {};
      for (const r of profitDataAll) {
        const iso = toISO10(r.date);
        totalCostsByDateAll[iso] =
          Number((r as any).paid_spend || 0) +
          Number((r as any).est_cogs || 0) +
          Number((r as any).est_processing_fees || 0) +
          Number((r as any).est_fulfillment_costs || 0) +
          Number((r as any).est_other_variable_costs || 0) +
          Number((r as any).est_other_fixed_costs || 0);
      }
      const forwardTracked = buildForwardSum(trackedRevByDateAll, primary.startISO, primary.days, attribWindowDays);
      const forwardTotal = buildForwardSum(revenueByDatePrimary, primary.startISO, primary.days, attribWindowDays);
      const forwardCosts = buildForwardSum(totalCostsByDateAll, primary.startISO, primary.days, attribWindowDays);
      const attribSeriesBuilt: {
        date: string;
        mer_w: number;
        roas_w: number;
        spend: number;
        rev_total_w: number;
        rev_tracked_w: number;
      }[] = [];
      for (let i = 0; i < primary.days; i++) {
        const iso = addDaysISO(primary.startISO, i);
        const spend = Number(spendByDatePrimary[iso] || 0);
        const revTrackedW = Number(forwardTracked[iso] || 0);
        const revTotalW = Number(forwardTotal[iso] || 0);
        const roasW = spend > 0 ? revTrackedW / spend : 0;
        const costW = Number(forwardCosts[iso] || 0);
        const merW = costW > 0 ? revTotalW / costW : 0;
        attribSeriesBuilt.push({
          date: iso,
          mer_w: Number(merW.toFixed(2)),
          roas_w: Number(roasW.toFixed(2)),
          spend,
          rev_total_w: revTotalW,
          rev_tracked_w: revTrackedW,
        });
      }
      /** Commit state */
      // channel pie: sum by platform from spend series
      const sumSpend = (rows: { spend: number }[]) => rows.reduce((s, r) => s + Number(r.spend || 0), 0);
      const metaTotal = sumSpend(metaSpendSeriesBuilt);
      const googleTotal = sumSpend(googleSpendSeriesBuilt);
      const totalSpend = sumSpend(spendSeriesBuilt);
      const otherTotal = Math.max(0, totalSpend - metaTotal - googleTotal);
      const channel = [
        { name: "Meta Ads", value: metaTotal },
        { name: "Google Ads", value: googleTotal },
        { name: "Other", value: otherTotal },
      ]
        .filter((c) => Number.isFinite(c.value) && c.value > 0)
        .sort((a, b) => b.value - a.value);

      if (!cancelled) {
        setAdTotals(adAgg);
        setSpendSeries(spendSeriesBuilt);
        setMetaSpendSeries(metaSpendSeriesBuilt);
        setGoogleSpendSeries(googleSpendSeriesBuilt);
        setSpendSeriesCompare(effectiveCompareWindow ? spendSeriesCompareBuilt : []);
        setMetaSpendSeriesCompare(effectiveCompareWindow ? metaSpendSeriesCompareBuilt : []);
        setGoogleSpendSeriesCompare(effectiveCompareWindow ? googleSpendSeriesCompareBuilt : []);
        setTotalCostSeries(totalCostSeriesBuilt);
        setTotalCostSeriesCompare(effectiveCompareWindow ? totalCostSeriesCompareBuilt : []);
        setSpendByChannel(channel);
        setBizTotals({
          revenue: bizRevenue,
          orders: bizOrders,
          units: bizUnits,
          aov: bizAov,
          asp: bizAsp,
          daysLoaded: inPrimarySales.length,
        });
        setCompareTotals(
          effectiveCompareWindow
            ? {
                adSpend: compareSpend,
                adRevenue: compareAdRevenue,
                adClicks: compareClicks,
                adImpressions: compareImpressions,
                bizRevenue: compareBizRevenue,
                bizOrders: compareBizOrders,
                bizUnits: compareBizUnits,
              }
            : { adSpend: 0, adRevenue: 0, adClicks: 0, adImpressions: 0, bizRevenue: 0, bizOrders: 0, bizUnits: 0 }
        );
        setSalesSeries(inPrimarySales);
        setSalesSeriesCompare(effectiveCompareWindow ? inCompareSales : []);
        setRevenueSeries(revenueSeriesBuilt);
        setGoogleRevenueSeries(googleRevenueSeriesBuilt);
        setMetaRevenueSeries(metaRevenueSeriesBuilt);
        setRevenueSeriesCompare(effectiveCompareWindow ? revenueSeriesCompareBuilt : []);
        setGoogleRevenueSeriesCompare(effectiveCompareWindow ? googleRevenueSeriesCompareBuilt : []);
        setMetaRevenueSeriesCompare(effectiveCompareWindow ? metaRevenueSeriesCompareBuilt : []);
        setAspSeries(aspSeriesBuilt);
        setAspSeriesCompare(effectiveCompareWindow ? aspSeriesCompareBuilt : []);
        setMerSeries(merSeriesBuilt);
        setMerSeriesCompare(effectiveCompareWindow ? merSeriesCompareBuilt : []);
        setProfitMerSeries(profitMerSeriesBuilt);
        setProfitMerSeriesCompare(effectiveCompareWindow ? profitMerSeriesCompareBuilt : []);
        setContribProfitSeries(contribProfitSeriesBuilt);
        setContribProfitSeriesCompare(effectiveCompareWindow ? contribProfitSeriesCompareBuilt : []);
        setProfitTotals({
          paidSpend: profitPrimaryAgg.paidSpend,
          contributionProfit: profitPrimaryAgg.contributionProfit,
          profitMer: profitPrimaryMer,
          estCogs: profitPrimaryAgg.estCogs,
          estProcessingFees: profitPrimaryAgg.estProcessingFees,
          estFulfillmentCosts: profitPrimaryAgg.estFulfillmentCosts,
          estOtherVariableCosts: profitPrimaryAgg.estOtherVariableCosts,
          estOtherFixedCosts: profitPrimaryAgg.estOtherFixedCosts,
        });
        setCompareProfitTotals({
          paidSpend: profitCompareAgg.paidSpend,
          contributionProfit: profitCompareAgg.contributionProfit,
          profitMer: profitCompareMer,
          estCogs: profitCompareAgg.estCogs,
          estProcessingFees: profitCompareAgg.estProcessingFees,
          estFulfillmentCosts: profitCompareAgg.estFulfillmentCosts,
          estOtherVariableCosts: profitCompareAgg.estOtherVariableCosts,
          estOtherFixedCosts: profitCompareAgg.estOtherFixedCosts,
        });
        setAttribSeries(attribSeriesBuilt);
        setEventsPrimary(primaryEventsData);
        setEvents30Count(typeof count30 === "number" ? count30 : null);
        setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    initialClientId,
    range,
    rangeDays,
    windows,
    router,
    compareModeSetting,
    showEvents30,
    customStartISO,
    customEndISO,
    attribWindowDays,
    refreshNonce,
  ]);
  /** Monthly rollup table fetch */
  useEffect(() => {
    let cancelled = false;
    const runMonthly = async () => {
      if (!clientId) return;
      setMonthlyLoading(true);
      setMonthlyError("");
      const { data, error } = await supabase
        .from("monthly_rollup")
        .select("*")
        .eq("client_id", clientId)
        .order("month", { ascending: false })
        .limit(monthlyMonths);
      if (cancelled) return;
      if (error) {
        console.error(error);
        setMonthlyError(error.message || "Failed to load monthly rollup");
        setMonthlyRows([]);
        setMonthlyLoading(false);
        return;
      }
      const rows = (data || []).map((r: any) => {
        const shopifyRevenue = getNum(r, [
          "shopify_revenue",
          "shopify_gross_revenue",
          "shopify_total_sales",
          "shopify_sales",
          "revenue",
          "shopifyRevenue",
        ]);
        const shopifyOrders = getNum(r, ["shopify_orders", "orders", "shopifyOrders"], 0);
        const metaSpend = getNum(r, ["meta_spend", "facebook_spend", "fb_spend", "metaSpend"], 0);
        const googleSpend = getNum(r, ["google_spend", "adwords_spend", "googleSpend"], 0);
        const totalAdSpend = getNum(r, ["total_ad_spend", "ad_spend", "totalSpend", "spend"], metaSpend + googleSpend);
        const trueRoas = totalAdSpend > 0 ? shopifyRevenue / totalAdSpend : null;
        const aov = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : null;
        const cpo = shopifyOrders > 0 ? totalAdSpend / shopifyOrders : null;
        const profitFromDb = getNum(
          r,
          [
            "profit",
            "store_profit",
            "total_store_profit",
            "contribution_profit",
            "total_contribution_profit",
            "contribution_profit_sum",
          ],
          NaN
        );
        const profit =
          marginAfterCostsPct != null
            ? shopifyRevenue * marginAfterCostsPct - totalAdSpend
            : Number.isFinite(profitFromDb)
            ? profitFromDb
            : null;
        return {
          month: monthLabel(r?.month || r?.month_start || r?.monthStart || r?.date || r?.period),
          shopifyRevenue,
          shopifyOrders,
          metaSpend,
          googleSpend,
          totalAdSpend,
          trueRoas,
          aov,
          cpo,
          profit,
        } as MonthlyRow;
      });
      // Display oldest -> newest
      rows.sort((a: any, b: any) => (a.month > b.month ? 1 : a.month < b.month ? -1 : 0));
      setMonthlyRows(rows);
      setMonthlyLoading(false);
    };
    runMonthly();
    return () => {
      cancelled = true;
    };
  }, [clientId, monthlyMonths, marginAfterCostsPct]);
  /** Derived metrics */
  const adRoas = adTotals.spend > 0 ? bizTotals.revenue / adTotals.spend : 0;
  const ctr = adTotals.impressions > 0 ? (adTotals.clicks / adTotals.impressions) * 100 : null;
  const profitPrimaryValue =
    Number.isFinite(Number(profitTotals.contributionProfit))
      ? Number(profitTotals.contributionProfit)
      : 0;
  const profitCompareValue =
    Number.isFinite(Number(compareProfitTotals.contributionProfit))
      ? Number(compareProfitTotals.contributionProfit)
      : 0;
  const totalCostsPrimaryKpi = bizTotals.revenue - profitPrimaryValue;
  const totalCostsCompareKpi = compareTotals.bizRevenue - profitCompareValue;
  const totalCostsPrimary = Number(profitTotals.paidSpend || 0);
  const totalCostsCompare = Number(compareProfitTotals.paidSpend || 0);
  const mer = adTotals.spend > 0 ? bizTotals.revenue / adTotals.spend : 0;
  const profitReturnOnCosts = totalCostsPrimary > 0 ? profitPrimaryValue / totalCostsPrimary : 0;
  const prevAov =
    effectiveShowComparison && compareTotals.bizOrders > 0 ? compareTotals.bizRevenue / compareTotals.bizOrders : 0;
  const prevAsp =
    effectiveShowComparison && compareTotals.bizUnits > 0 ? compareTotals.bizRevenue / compareTotals.bizUnits : 0;
  const prevMer =
    effectiveShowComparison && compareTotals.adSpend > 0 ? compareTotals.bizRevenue / compareTotals.adSpend : 0;
  const prevProfitReturnOnCosts =
    effectiveShowComparison && totalCostsCompare > 0 ? profitCompareValue / totalCostsCompare : 0;
  const prevRoas =
    effectiveShowComparison && compareTotals.adSpend > 0 ? compareTotals.bizRevenue / compareTotals.adSpend : 0;
  const prevCtr =
    effectiveShowComparison && compareTotals.adImpressions > 0
      ? (compareTotals.adClicks / compareTotals.adImpressions) * 100
      : null;
  const prevRevenue = effectiveShowComparison ? compareTotals.bizRevenue : 0;
  const prevOrders = effectiveShowComparison ? compareTotals.bizOrders : 0;
  /** Profit (estimated) series for charting (margin × revenue − ad spend) */
  
  // Simple rolling average helper for numeric series fields (keeps original dates).
  function buildRollingAvgSeries<T extends { date: string }>(
    series: T[] | null | undefined,
    key: keyof T,
    windowDays: number
  ): T[] {
    const src = (series ?? []) as any[];
    const w = Math.max(1, Math.floor(Number(windowDays) || 1));
    const out: any[] = [];
    const q: number[] = [];
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      const raw = src[i]?.[key as any];
      const v = Number(raw);
      const ok = raw != null && Number.isFinite(v);
      q.push(ok ? v : 0);
      sum += ok ? v : 0;
      if (q.length > w) sum -= q.shift() || 0;
      out.push({ ...src[i], [key]: ok ? sum / q.length : null });
    }
    return out as T[];
  }
  const profitSeries = useMemo(() => {
    const spendMap: Record<string, number> = {};
    // NOTE:
    // Profit Trend must use the same contribution-profit calculation as KPI cards.
    // Using Revenue×Margin−Spend can silently break when data sources have partial coverage
    // or when spend/revenue series alignment changes across larger date ranges.
    return contribProfitSeries.map((d) => ({
      date: d.date,
      profit: Number(Number(d.contribution_profit ?? 0).toFixed(2)),
    }));
  }, [contribProfitSeries]);
  const profitSeriesCompare = useMemo(() => {
    if (!effectiveShowComparison) return [];
    return contribProfitSeriesCompare.map((d) => ({
      date: d.date,
      profit: Number(Number(d.contribution_profit ?? 0).toFixed(2)),
    }));
  }, [contribProfitSeriesCompare, effectiveShowComparison]);
  const profitTrendSeries = useMemo(() => {
    return profitRollingEnabled ? buildRollingAvgSeries(profitSeries, "profit", profitRollingWindowDays) : profitSeries;
  }, [profitRollingEnabled, profitRollingWindowDays, profitSeries]);
  const profitTrendSeriesCompare = useMemo(() => {
    return profitRollingEnabled
      ? buildRollingAvgSeries(profitSeriesCompare, "profit", profitRollingWindowDays)
      : profitSeriesCompare;
  }, [profitRollingEnabled, profitRollingWindowDays, profitSeriesCompare]);
  const revenueTrendSeries = useMemo(() => {
    return revenueRollingEnabled ? buildRollingAvgSeries(revenueSeries, "revenue", revenueRollingWindowDays) : revenueSeries;
  }, [revenueRollingEnabled, revenueRollingWindowDays, revenueSeries]);
  const revenueTrendSeriesCompare = useMemo(() => {
    return revenueRollingEnabled
      ? buildRollingAvgSeries(revenueSeriesCompare, "revenue", revenueRollingWindowDays)
      : revenueSeriesCompare;
  }, [revenueRollingEnabled, revenueRollingWindowDays, revenueSeriesCompare]);
  const aspTrendSeries = useMemo(() => {
    return aspRollingEnabled ? buildRollingAvgSeries(aspSeries, "asp", aspRollingWindowDays) : aspSeries;
  }, [aspRollingEnabled, aspRollingWindowDays, aspSeries]);
  const aspTrendSeriesCompare = useMemo(() => {
    return aspRollingEnabled ? buildRollingAvgSeries(aspSeriesCompare, "asp", aspRollingWindowDays) : aspSeriesCompare;
  }, [aspRollingEnabled, aspRollingWindowDays, aspSeriesCompare]);
  /** Selected spend series based on chart type */
  const spendChartData = useMemo(() => {
    return spendSeries.map((item, index) => ({
      date: item.date,
      ts: new Date(`${item.date}T00:00:00Z`).getTime(),
      total_spend: item.spend,
      meta_spend: metaSpendSeries[index]?.spend || 0,
      google_spend: googleSpendSeries[index]?.spend || 0,
    }));
  }, [spendSeries, metaSpendSeries, googleSpendSeries, windowStartISO, windowEndISO, rangeDays]);
  const spendChartRows = useMemo(() => {
    if (spendSeries.length === 0) return [] as typeof spendChartData;
    return spendChartData;
  }, [spendSeries.length, spendChartData, windowStartISO, windowEndISO, rangeDays]);
  /** Spend chart series configuration */
  const spendChartSeries = useMemo(() => {
    const series = [];
    if (showTotalSpend) series.push({ key: 'total_spend', name: 'Total Spend', color: '#3b82f6' });
    if (showMetaSpend) series.push({ key: 'meta_spend', name: 'Meta Ads', color: '#10b981' });
    if (showGoogleSpend) series.push({ key: 'google_spend', name: 'Google Ads', color: '#f59e0b' });
    return series;
  }, [showTotalSpend, showMetaSpend, showGoogleSpend]);
  const spendChartDataCompare = useMemo(() => {
    return spendSeriesCompare.map((item, index) => ({
      date: item.date,
      ts: new Date(`${item.date}T00:00:00Z`).getTime(),
      total_spend: item.spend,
      meta_spend: metaSpendSeriesCompare[index]?.spend || 0,
      google_spend: googleSpendSeriesCompare[index]?.spend || 0,
    }));
  }, [spendSeriesCompare, metaSpendSeriesCompare, googleSpendSeriesCompare, windowStartISO, windowEndISO, rangeDays]);
  /** Revenue chart data and series configuration */
  const revenueChartData = useMemo(() => {
    return revenueSeries.map((item, index) => ({
      date: item.date,
      ts: new Date(`${item.date}T00:00:00Z`).getTime(),
      shopify_total: item.revenue,
      google_revenue: googleRevenueSeries[index]?.revenue || 0,
      meta_revenue: metaRevenueSeries[index]?.revenue || 0,
    }));
  }, [revenueSeries, googleRevenueSeries, metaRevenueSeries, windowStartISO, windowEndISO, rangeDays]);
  const revenueChartRows = useMemo(() => {
    if (revenueSeries.length === 0) return [] as typeof revenueChartData;
    return revenueChartData;
  }, [revenueSeries.length, revenueChartData, windowStartISO, windowEndISO, rangeDays]);
  const revenueChartDataCompare = useMemo(() => {
    return revenueSeriesCompare.map((item, index) => ({
      date: item.date,
      ts: new Date(`${item.date}T00:00:00Z`).getTime(),
      shopify_total: item.revenue,
      google_revenue: googleRevenueSeriesCompare[index]?.revenue || 0,
      meta_revenue: metaRevenueSeriesCompare[index]?.revenue || 0,
    }));
  }, [revenueSeriesCompare, googleRevenueSeriesCompare, metaRevenueSeriesCompare, windowStartISO, windowEndISO, rangeDays]);
  const revenueChartSeries = useMemo(() => {
    const series = [];
    if (showShopifyRevenue) series.push({ key: 'shopify_total', name: 'Shopify Total', color: '#10b981' });
    if (showGoogleRevenue) series.push({ key: 'google_revenue', name: 'Google', color: '#f59e0b' });
    if (showMetaRevenue) series.push({ key: 'meta_revenue', name: 'Meta', color: '#8b5cf6' });
    return series;
  }, [showShopifyRevenue, showGoogleRevenue, showMetaRevenue]);
  const compareFrac = useMemo(() => {
    if (!effectiveShowComparison) return 0;
    if (rangeDays <= 0) return 0;
    return Math.min(1, Math.max(0, coverage.compareSales / rangeDays));
  }, [effectiveShowComparison, coverage.compareSales, rangeDays]);
  const conf = useMemo(() => confidenceLabel(compareFrac), [compareFrac]);
  const compareLabel = useMemo(() => {
    if (liftFocusEventId) return "Before change";
    if (!comparisonEnabled) return "Off";
    return compareModeSetting === "previous_period" ? "Previous Period" : "Previous Year";
  }, [liftFocusEventId, comparisonEnabled, compareModeSetting]);
  /** Lift */
  const liftWindows = useMemo(() => {
    // Default: compare the selected date range to the chosen compare mode
    if (!liftFocusEventId) {
      return { primary: windows.primary, compare: windows.compare, label: "" };
    }
    const ev = eventsPrimary.find((e) => e.id === liftFocusEventId);
    if (!ev) return { primary: windows.primary, compare: windows.compare, label: "" };
    // Event-focused mode: "since change" vs an equal-length window immediately before the change.
    const evStart = String(ev.event_date).slice(0, 10);
    const clampedStart = evStart < windows.primary.startISO ? windows.primary.startISO : evStart;
    const primary = buildPrimaryWindowCustom(clampedStart, windows.primary.endISO);
    const compare = buildPrecedingWindow(primary.startISO, primary.days);
    const labelBase = ev.title?.trim() ? ev.title.trim() : "Selected change";
    return { primary, compare, label: `${labelBase} • ${evStart}` };
  }, [liftFocusEventId, eventsPrimary, windows.primary.startISO, windows.primary.endISO, windows.compare, windows.primary, windows.compare, compareMode]);
  const lift = useMemo(() => {
    const scopePrimary = liftWindows.primary;
    const scopeCompare = liftWindows.compare;
    // Build date-indexed maps from BOTH primary + compare series so event-focused windows can span either side.
    const salesByDate: Record<string, SalesSummaryRow> = {};
    for (const r of salesSeries) salesByDate[r.date] = r;
    for (const r of salesSeriesCompare) salesByDate[r.date] = r;
    const spendByDate: Record<string, number> = {};
    for (const r of spendSeries) spendByDate[r.date] = Number(r.spend ?? 0);
    for (const r of spendSeriesCompare) spendByDate[r.date] = Number(r.spend ?? 0);
    const sumSales = (s: string, e: string) => {
      let revenue = 0;
      let orders = 0;
      let units = 0;
      let missing = 0;
      for (let d = s; d <= e; d = addDaysISO(d, 1)) {
        const row = salesByDate[d];
        if (!row) {
          missing += 1;
          continue;
        }
        revenue += Number(row.revenue ?? 0);
        orders += Number(row.orders ?? 0);
        units += Number(row.units ?? 0);
      }
      const aov = orders > 0 ? revenue / orders : 0;
      const asp = units > 0 ? revenue / units : 0;
      return { revenue, orders, units, aov, asp, missing };
    };
    const sumSpend = (s: string, e: string) => {
      let spend = 0;
      let missing = 0;
      for (let d = s; d <= e; d = addDaysISO(d, 1)) {
        if (!(d in spendByDate)) {
          missing += 1;
          continue;
        }
        spend += Number(spendByDate[d] ?? 0);
      }
      return { spend, missing };
    };
    const primarySales = sumSales(scopePrimary.startISO, scopePrimary.endISO);
    const compareSales =
      scopeCompare ? sumSales(scopeCompare.startISO, scopeCompare.endISO) : { revenue: 0, orders: 0, units: 0, aov: 0, asp: 0, missing: 0 };
    const primarySpend = sumSpend(scopePrimary.startISO, scopePrimary.endISO);
    const compareSpend =
      scopeCompare ? sumSpend(scopeCompare.startISO, scopeCompare.endISO) : { spend: 0, missing: 0 };
    // When focusing on a change/event, we want to show *something* even if the global comparison toggle is off.
    // But we still require that we actually have baseline days to compare against.
    const wantsCompare = !!scopeCompare;
    const compareDays = wantsCompare ? scopeCompare!.days : 0;
    const compareAvailable =
      wantsCompare &&
      compareDays > 0 &&
      // at least 70% of days present (sales)
      compareSales.missing <= Math.floor(compareDays * 0.3);
    const hasCompare =
      (liftFocusEventId ? compareAvailable : (effectiveShowComparison && compareAvailable));
    if (!hasCompare || !scopeCompare) {
      return {
        hasCompare: false,
        scopeLabel: liftWindows.label,
        scopeStartISO: scopePrimary.startISO,
        scopeEndISO: scopePrimary.endISO,
        days: scopePrimary.days,
        primary: {
        revenue: primarySales.revenue,
        orders: primarySales.orders,
        units: primarySales.units,
        asp: primarySales.asp,
        aov: primarySales.aov,
        spend: primarySpend.spend,
        roas: primarySpend.spend > 0 ? primarySales.revenue / primarySpend.spend : 0,
        profit:
          marginAfterCostsPct != null
            ? primarySales.revenue * marginAfterCostsPct - primarySpend.spend
            : null,
        profitReturnOnCosts:
          marginAfterCostsPct != null && primarySpend.spend > 0
            ? (primarySales.revenue * marginAfterCostsPct - primarySpend.spend) / primarySpend.spend
            : null,
      },
        compare: null,
        revenueLift: 0,
        revenueLiftPct: 0,
        ordersLift: 0,
        ordersLiftPct: 0,
        aspLift: 0,
        aspLiftPct: 0,
        aovLift: 0,
        aovLiftPct: 0,
        profitLift: null,
        profitLiftPct: null,
        procLift: null,
        procLiftPct: null,
        merLift: 0,
        merLiftPct: 0,
        priceDriven: 0,
        volumeDriven: 0,
        interaction: 0,
      };
    }
    const revLift = primarySales.revenue - compareSales.revenue;
    const ordLift = primarySales.orders - compareSales.orders;
    const aspLift = primarySales.asp - compareSales.asp;
    const aovLift = primarySales.aov - compareSales.aov;
    const profitP =
      marginAfterCostsPct != null ? primarySales.revenue * marginAfterCostsPct - primarySpend.spend : null;
    const profitC =
      marginAfterCostsPct != null ? compareSales.revenue * marginAfterCostsPct - compareSpend.spend : null;
    const profitLift = profitP != null && profitC != null ? profitP - profitC : null;
    const profitLiftPct = profitC != null && profitC !== 0 ? (profitLift! / profitC) * 100 : null;
    const procP = profitP != null && primarySpend.spend > 0 ? profitP / primarySpend.spend : null;
    const procC = profitC != null && compareSpend.spend > 0 ? profitC / compareSpend.spend : null;
    const procLift = procP != null && procC != null ? procP - procC : null;
    const procLiftPct = procC != null && procC !== 0 ? (procLift! / procC) * 100 : null;
    const revLiftPct = compareSales.revenue !== 0 ? (revLift / compareSales.revenue) * 100 : 0;
    const ordLiftPct = compareSales.orders !== 0 ? (ordLift / compareSales.orders) * 100 : 0;
    const aspLiftPct = compareSales.asp !== 0 ? (aspLift / compareSales.asp) * 100 : 0;
    const aovLiftPct = compareSales.aov !== 0 ? (aovLift / compareSales.aov) * 100 : 0;
    const primaryMer = primarySpend.spend > 0 ? primarySales.revenue / primarySpend.spend : 0;
    const compareMer = compareSpend.spend > 0 ? compareSales.revenue / compareSpend.spend : 0;
    const merLift = primaryMer - compareMer;
    const merLiftPct = compareMer !== 0 ? (merLift / compareMer) * 100 : 0;
    // Revenue decomposition using Units × ASP (price vs volume)
    const aspP = primarySales.asp;
    const aspC = compareSales.asp;
    const uP = primarySales.units;
    const uC = compareSales.units;
    const priceDriven = (aspP - aspC) * uC;
    const volumeDriven = (uP - uC) * aspC;
    const interaction = (aspP - aspC) * (uP - uC);
    return {
      hasCompare: true,
      scopeLabel: liftWindows.label,
      scopeStartISO: scopePrimary.startISO,
      scopeEndISO: scopePrimary.endISO,
      days: scopePrimary.days,
      primary: {
        revenue: primarySales.revenue,
        orders: primarySales.orders,
        units: primarySales.units,
        asp: primarySales.asp,
        aov: primarySales.aov,
        spend: primarySpend.spend,
        roas: primarySpend.spend > 0 ? primarySales.revenue / primarySpend.spend : 0,
        profit:
          marginAfterCostsPct != null
            ? primarySales.revenue * marginAfterCostsPct - primarySpend.spend
            : null,
        profitReturnOnCosts:
          marginAfterCostsPct != null && primarySpend.spend > 0
            ? (primarySales.revenue * marginAfterCostsPct - primarySpend.spend) / primarySpend.spend
            : null,
      },
      compare: {
        revenue: compareSales.revenue,
        orders: compareSales.orders,
        units: compareSales.units,
        asp: compareSales.asp,
        aov: compareSales.aov,
        spend: compareSpend.spend,
        roas: compareSpend.spend > 0 ? compareSales.revenue / compareSpend.spend : 0,
        profit:
          marginAfterCostsPct != null
            ? compareSales.revenue * marginAfterCostsPct - compareSpend.spend
            : null,
        profitReturnOnCosts:
          marginAfterCostsPct != null && compareSpend.spend > 0
            ? (compareSales.revenue * marginAfterCostsPct - compareSpend.spend) / compareSpend.spend
            : null,
      },
      revenueLift: revLift,
      revenueLiftPct: revLiftPct,
      ordersLift: ordLift,
      ordersLiftPct: ordLiftPct,
      aspLift,
      aspLiftPct,
      aovLift,
      aovLiftPct,
      profitLift,
      profitLiftPct,
      procLift,
      procLiftPct,
      merLift,
      merLiftPct,
      priceDriven,
      volumeDriven,
      interaction,
    };
  }, [
    effectiveShowComparison,
    liftFocusEventId,
    liftWindows,
    salesSeries,
    salesSeriesCompare,
    spendSeries,
    spendSeriesCompare,
    marginAfterCostsPct,
  ]);
  /** Events to markers */
  const eventMarkers = useMemo<EventMarker[]>(() => {
    const mapped = (eventsPrimary ?? [])
      .map((e) => {
        const iso = String(e.event_date || "").slice(0, 10);
        let x2: string | undefined = undefined;
        if (e.impact_window_days && e.impact_window_days > 1) {
          x2 = addDaysISO(iso, e.impact_window_days - 1);
        }
        return {
          id: e.id,
          x: iso,
          x2,
          iso,
          title: e.title,
          type: e.type,
          notes: e.notes ?? null,
          impact_window_days: e.impact_window_days ?? null,
        };
      })
      .filter((m) => !!m.x);
    return mapped.slice(0, 25);
  }, [eventsPrimary]);
  /** Event impact overlay */
  const eventImpact = useMemo(() => {
    if (!effectiveShowComparison) {
      return {
        has: false,
        flaggedDays: 0,
        insideLift: 0,
        outsideLift: 0,
        insideShare: 0,
        insideMerLift: 0,
        outsideMerLift: 0,
      };
    }
    const dates = revenueSeries.map((r) => toISO10(r.date));
    const flagged = buildEventDateFlags(dates, eventMarkers);
    const pRevInside = sumSeriesByFlag(revenueSeries, "revenue", flagged, true);
    const cRevInside = sumSeriesByFlag(revenueSeriesCompare, "revenue", flagged, true);
    const pRevOutside = sumSeriesByFlag(revenueSeries, "revenue", flagged, false);
    const cRevOutside = sumSeriesByFlag(revenueSeriesCompare, "revenue", flagged, false);
    const insideLift = pRevInside - cRevInside;
    const outsideLift = pRevOutside - cRevOutside;
    const pSpendInside = sumSeriesByFlag(spendSeries, "spend", flagged, true);
    const cSpendInside = sumSeriesByFlag(spendSeriesCompare, "spend", flagged, true);
    const pSpendOutside = sumSeriesByFlag(spendSeries, "spend", flagged, false);
    const cSpendOutside = sumSeriesByFlag(spendSeriesCompare, "spend", flagged, false);
    const pMerInside = pSpendInside > 0 ? pRevInside / pSpendInside : 0;
    const cMerInside = cSpendInside > 0 ? cRevInside / cSpendInside : 0;
    const pMerOutside = pSpendOutside > 0 ? pRevOutside / pSpendOutside : 0;
    const cMerOutside = cSpendOutside > 0 ? cRevOutside / cSpendOutside : 0;
    const totalLift = insideLift + outsideLift;
    const insideShare = totalLift !== 0 ? (insideLift / totalLift) * 100 : 0;
    return {
      has: flagged.size > 0,
      flaggedDays: flagged.size,
      insideLift,
      outsideLift,
      insideShare,
      insideMerLift: pMerInside - cMerInside,
      outsideMerLift: pMerOutside - cMerOutside,
    };
  }, [effectiveShowComparison, revenueSeries, revenueSeriesCompare, spendSeries, spendSeriesCompare, eventMarkers]);
  // Helper function to render sub text with color coding for comparison values
  const renderSubText = (label: string, sub: string | React.ReactNode) => {
    // If it's not a string, return as-is
    if (typeof sub !== 'string') return sub;
    // Exclude ASP, Ad Spend, and CTR from color coding
    const excludedLabels = ["ASP", "Ad Spend", "CTR"];
    if (!excludedLabels.includes(label) && sub.includes("vs prev:")) {
      const parts = sub.split("vs prev:");
      if (parts.length === 2) {
        const prefix = parts[0] + "vs prev:";
        const comparisonValue = parts[1].trim();
        const isPositive = comparisonValue.startsWith("+");
        const isNegative = comparisonValue.startsWith("-");
        return (
          <span>
            {prefix}
            <span className={isPositive ? "text-green-600" : isNegative ? "text-red-600" : ""}>
              {comparisonValue}
            </span>
          </span>
        );
      }
    }
    return sub;
  };
  /** KPI cards */
  const kpis = useMemo(() => {
    const fmtDelta = (v: number, allow: boolean) => {
      if (!allow) return "—";
      return v === 999 ? "↑" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    };
    const profitPrimary = Number.isFinite(Number(profitTotals.contributionProfit))
      ? Number(profitTotals.contributionProfit)
      : null;
    const profitCompare = Number.isFinite(Number(compareProfitTotals.contributionProfit))
      ? Number(compareProfitTotals.contributionProfit)
      : null;
    if (!effectiveShowComparison) {
      return [
        { label: "Total Revenue", value: formatCurrency(bizTotals.revenue), sub: `${rangeDays} day(s) • Shopify revenue`, trend: undefined },
        {
          label: "Total Costs",
          value: formatCurrency(totalCostsPrimaryKpi),
          sub: "Total operating costs including COGS, fulfillment, fees, and paid advertising.",
          trend: undefined,
        },
        {
          label: "Profit",
          value:
            profitPrimary != null ? formatCurrency(profitPrimary) : "—",
          sub:
            profitPrimary != null ? "Contribution profit after costs & ad spend" : "—",
          trend: undefined,
        },
        { label: "Orders", value: formatNumber(bizTotals.orders), sub: "Shopify orders", trend: undefined },
        { label: "AOV", value: formatCurrency(bizTotals.aov), sub: "Average order value", trend: undefined },
        { label: "ASP", value: formatCurrency(bizTotals.asp), sub: "Average selling price", trend: undefined },
        { label: "Ad Spend", value: formatCurrency(adTotals.spend), sub: "Total ad spend", trend: undefined },
        { label: "Ad ROAS", value: `${adRoas.toFixed(2)}x`, sub: "Return on ad spend", trend: undefined },
        {
          label: "Profit Return",
          value: `${profitReturnOnCosts.toFixed(2)}x`,
          sub: "Contribution profit per $1 of ad spend",
          trend: undefined,
        },
        { label: "CTR", value: ctr != null ? formatPct(ctr) : "—", sub: "Click-through-rate", trend: undefined },
      ];
    }
    // For custom ranges, use lower threshold (50%) for showing comparison data
    // For presets, require higher confidence (95%)
    const threshold = range === "CUSTOM" ? 0.5 : 0.95;
    const allowPct = compareFrac >= threshold;
    const revDelta = pctChange(bizTotals.revenue, compareTotals.bizRevenue);
    const ordDelta = pctChange(bizTotals.orders, compareTotals.bizOrders);
    const aovDelta = pctChange(bizTotals.aov, prevAov);
    const aspDelta = pctChange(bizTotals.asp, prevAsp);
    const spendDelta = pctChange(adTotals.spend, compareTotals.adSpend);
    const roasDelta = pctChange(adRoas, prevRoas);
    const ctrDelta = ctr != null && prevCtr != null ? pctChange(ctr, prevCtr) : 0;
    const totalCostsDelta = pctChange(totalCostsPrimaryKpi, totalCostsCompareKpi);
    const merDelta = pctChange(profitReturnOnCosts, prevProfitReturnOnCosts);
    return [
      { label: "Total Revenue", value: formatCurrency(bizTotals.revenue), sub: `vs prev: ${fmtDelta(revDelta, allowPct)}`, trend: allowPct ? revDelta : undefined },
      {
        label: "Total Costs",
        value: formatCurrency(totalCostsPrimaryKpi),
        sub: `vs prev: ${fmtDelta(totalCostsDelta, allowPct)}`,
        trend: allowPct ? totalCostsDelta : undefined,
      },
      {
        label: "Profit",
        value:
          profitPrimary != null ? formatCurrency(profitPrimary) : "—",
        sub:
          profitPrimary != null && profitCompare != null
            ? `vs prev: ${formatSignedCurrency(profitPrimary - profitCompare)}`
            : "—",
        trend:
          profitPrimary != null && profitCompare != null && allowPct
            ? pctChange(profitPrimary, profitCompare)
            : undefined,
      },
      { label: "Orders", value: formatNumber(bizTotals.orders), sub: `vs prev: ${fmtDelta(ordDelta, allowPct)}`, trend: allowPct ? ordDelta : undefined },
      { label: "AOV", value: formatCurrency(bizTotals.aov), sub: `vs prev: ${fmtDelta(aovDelta, allowPct)}`, trend: allowPct ? aovDelta : undefined },
      { label: "ASP", value: formatCurrency(bizTotals.asp), sub: `vs prev: ${fmtDelta(aspDelta, allowPct)}`, trend: allowPct ? aspDelta : undefined },
      { label: "Ad Spend", value: formatCurrency(adTotals.spend), sub: `vs prev: ${fmtDelta(spendDelta, allowPct)}`, trend: allowPct ? spendDelta : undefined },
      { label: "Ad ROAS", value: `${adRoas.toFixed(2)}x`, sub: `vs prev: ${fmtDelta(roasDelta, allowPct)}`, trend: allowPct ? roasDelta : undefined },
      {
        label: "Profit Return",
        value: `${profitReturnOnCosts.toFixed(2)}x`,
        sub: `vs prev: ${fmtDelta(merDelta, allowPct)}`,
        trend: allowPct ? merDelta : undefined,
      },
      {
        label: "CTR",
        value: ctr != null ? formatPct(ctr) : "—",
        sub: `vs prev: ${fmtDelta(ctrDelta, allowPct)}`,
        trend: ctr != null && prevCtr != null && allowPct ? ctrDelta : undefined,
      },
    ];
  }, [
    effectiveShowComparison,
    bizTotals,
    profitTotals,
    compareProfitTotals,
    compareTotals,
    adTotals,
    adRoas,
    ctr,
    mer,
    profitReturnOnCosts,
    prevProfitReturnOnCosts,
    profitPrimaryValue,
    profitCompareValue,
    totalCostsPrimaryKpi,
    totalCostsCompareKpi,
    totalCostsPrimary,
    totalCostsCompare,
    rangeDays,
    prevAov,
    prevAsp,
    prevMer,
    compareFrac,
    range,
    marginAfterCostsPct,
  ]);
  /** Labels and helpers */
  // Rolling ratio helper.
  // Default behavior is revenue ÷ spend (so existing MER Trend stays unchanged).
  const buildRollingMerSeries = useCallback(
    (
      spendS: { date: string; spend: number }[],
      numS: { date: string; [k: string]: any }[],
      windowDays: number,
      numKey: string = "revenue"
    ) => {
      const dates = (spendS ?? []).map((d) => d.date);
      if (!dates.length) return [];
      const spendBy = new Map<string, number>();
      for (const r of spendS ?? []) spendBy.set(r.date, Number(r.spend) || 0);
      const numBy = new Map<string, number>();
      for (const r of numS ?? []) numBy.set(r.date, Number((r as any)[numKey]) || 0);
      const spendArr = dates.map((dt) => spendBy.get(dt) ?? 0);
      const numArr = dates.map((dt) => numBy.get(dt) ?? 0);
      const prefSpend: number[] = [0];
      const prefNum: number[] = [0];
      for (let i = 0; i < dates.length; i++) {
        prefSpend.push(prefSpend[i] + spendArr[i]);
        prefNum.push(prefNum[i] + numArr[i]);
      }
      const out: { date: string; mer: number }[] = [];
      const w = Math.max(1, Math.floor(windowDays || 1));
      for (let i = 0; i < dates.length; i++) {
        const j0 = Math.max(0, i - w + 1);
        const spendSum = prefSpend[i + 1] - prefSpend[j0];
        const numSum = prefNum[i + 1] - prefNum[j0];
        out.push({ date: dates[i], mer: spendSum > 0 ? numSum / spendSum : 0 });
      }
      return out;
    },
    []
  );
  // Profit MER series normalized to the chart's expected yKey: "mer"
  const profitMerDailySeries = useMemo(() => {
    return (profitMerSeries ?? []).map((d) => ({ date: d.date, mer: Number((d as any).profit_mer) || 0 }));
  }, [profitMerSeries]);
  const profitMerDailySeriesCompare = useMemo(() => {
    return (profitMerSeriesCompare ?? []).map((d) => ({ date: d.date, mer: Number((d as any).profit_mer) || 0 }));
  }, [profitMerSeriesCompare]);
  const merTrendSeries = useMemo(() => {
    return merRollingEnabled ? buildRollingMerSeries(spendSeries as any, revenueSeries as any, merRollingWindowDays) : merSeries;
  }, [merRollingEnabled, merRollingWindowDays, buildRollingMerSeries, spendSeries, revenueSeries, merSeries]);
  const profitReturnDailySeries = useMemo(() => {
    const costByDate = new Map(totalCostSeries.map((d) => [d.date, Number(d.spend) || 0]));
    return (revenueSeries ?? []).map((d) => {
      const costs = costByDate.get(d.date) ?? 0;
      const rev = Number((d as any).revenue) || 0;
      return { date: d.date, mer: costs > 0 ? rev / costs : 0 };
    });
  }, [revenueSeries, totalCostSeries]);
  const profitReturnTrendSeries = useMemo(() => {
    return merRollingEnabled
      ? buildRollingMerSeries(totalCostSeries as any, revenueSeries as any, merRollingWindowDays)
      : profitReturnDailySeries;
  }, [merRollingEnabled, merRollingWindowDays, buildRollingMerSeries, totalCostSeries, revenueSeries, profitReturnDailySeries]);
  const profitMerTrendSeries = useMemo(() => {
    // Rolling contribution profit ÷ rolling ad spend (business-truth MER)
    return merRollingEnabled
      ? buildRollingMerSeries(spendSeries as any, contribProfitSeries as any, merRollingWindowDays, "contribution_profit")
      : profitMerDailySeries;
  }, [merRollingEnabled, merRollingWindowDays, buildRollingMerSeries, spendSeries, contribProfitSeries, profitMerDailySeries]);
  const merTrendSeriesCompare = useMemo(() => {
    if (!effectiveShowComparison) return [];
    return merRollingEnabled
      ? buildRollingMerSeries(spendSeriesCompare as any, revenueSeriesCompare as any, merRollingWindowDays)
      : merSeriesCompare;
  }, [
    effectiveShowComparison,
    merRollingEnabled,
    merRollingWindowDays,
    buildRollingMerSeries,
    spendSeriesCompare,
    revenueSeriesCompare,
    merSeriesCompare,
  ]);
  const profitReturnDailySeriesCompare = useMemo(() => {
    if (!effectiveShowComparison) return [];
    const costByDate = new Map(totalCostSeriesCompare.map((d) => [d.date, Number(d.spend) || 0]));
    return (revenueSeriesCompare ?? []).map((d) => {
      const costs = costByDate.get(d.date) ?? 0;
      const rev = Number((d as any).revenue) || 0;
      return { date: d.date, mer: costs > 0 ? rev / costs : 0 };
    });
  }, [effectiveShowComparison, revenueSeriesCompare, totalCostSeriesCompare]);
  const profitReturnTrendSeriesCompare = useMemo(() => {
    if (!effectiveShowComparison) return [];
    return merRollingEnabled
      ? buildRollingMerSeries(totalCostSeriesCompare as any, revenueSeriesCompare as any, merRollingWindowDays)
      : profitReturnDailySeriesCompare;
  }, [
    effectiveShowComparison,
    merRollingEnabled,
    merRollingWindowDays,
    buildRollingMerSeries,
    totalCostSeriesCompare,
    revenueSeriesCompare,
    profitReturnDailySeriesCompare,
  ]);
  const profitMerTrendSeriesCompare = useMemo(() => {
    if (!effectiveShowComparison) return [];
    return merRollingEnabled
      ? buildRollingMerSeries(
          spendSeriesCompare as any,
          contribProfitSeriesCompare as any,
          merRollingWindowDays,
          "contribution_profit"
        )
      : profitMerDailySeriesCompare;
  }, [
    effectiveShowComparison,
    merRollingEnabled,
    merRollingWindowDays,
    buildRollingMerSeries,
    spendSeriesCompare,
    contribProfitSeriesCompare,
    profitMerDailySeriesCompare,
  ]);
  const coverageLabel = useMemo(() => {
    const sales = `Shopify ${coverage.primarySales}/${rangeDays}`;
    const ads = `Ads ${coverage.primaryAds}/${rangeDays}`;
    return `${sales} • ${ads}`;
  }, [coverage, rangeDays]);
  const compareCoverageLabel = useMemo(() => {
    if (!effectiveShowComparison) return "";
    return `Prev: Shopify ${coverage.compareSales}/${rangeDays} • Ads ${coverage.compareAds}/${rangeDays}`;
  }, [effectiveShowComparison, coverage, rangeDays]);
  const eventsToShow = useMemo(() => {
    if (range === "7D" && showEvents30) return events30;
    return eventsPrimary;
  }, [range, showEvents30, events30, eventsPrimary]);
  const dataHealth = useMemo(() => {
    const missingShopify = Math.max(0, rangeDays - coverage.primarySales);
    const missingAds = Math.max(0, rangeDays - coverage.primaryAds);
    const missingCompareShopify = effectiveShowComparison ? Math.max(0, rangeDays - coverage.compareSales) : 0;
    const missingCompareAds = effectiveShowComparison ? Math.max(0, rangeDays - coverage.compareAds) : 0;
    return {
      missingShopify,
      missingAds,
      missingCompareShopify,
      missingCompareAds,
    };
  }, [rangeDays, coverage, effectiveShowComparison]);
  /** North Star */
  const northStar = useMemo(() => {
    const selected = kpis.find((k) => k.label === northStarKey) || kpis[0];
    const primary = selected?.value != null ? String(selected.value) : "—";
    const details = selected?.sub != null ? String(selected.sub) : "";
    const trend = typeof selected?.trend === "number" && Number.isFinite(selected.trend) ? selected.trend : null;
    const good = effectiveShowComparison ? (trend != null ? trend >= 0 : true) : true;

    return {
      title: "North Star",
      primary,
      sub: selected?.label || "North Star",
      details,
      deltaLine:
        effectiveShowComparison && trend != null
          ? `vs ${compareLabel.toLowerCase()}: ${formatSignedPct(trend)}`
          : "",
      good,
    };
  }, [kpis, northStarKey, effectiveShowComparison, compareLabel]);
  /** Attribution summary (range-level) */
  const attributionSummary = useMemo(() => {
    const primary = windows.primary;
    const endPlus = addDaysISO(primary.endISO, attribWindowDays - 1);
    // spend over [start..end]
    const spend = spendSeries.reduce((s, r) => s + Number(r.spend || 0), 0);
    // total revenue over [start..end+window-1]
    // We can approximate using revenueSeries (which is only [start..end]) + forward days not shown.
    // BUT: attribSeries already has forward sums per day; easiest is to sum the *first day* forward sums? No.
    // We'll compute from attribSeries by summing “rev_total_w” BUT that double counts overlaps.
    // So: use a simple client-safe heuristic:
    //   windowed revenue = sum daily revenue from start..end (shown) + assume forward days from last (attribSeries last day forward includes them)
    // Better:
    //   total windowed revenue = sum revenueSeries + (rev in (end+1..end+window-1)) which we don't store.
    // To keep it consistent with what we actually show, we'll report:
    //   “Average daily windowed MER/ROAS” and “Median daily windowed MER/ROAS”
    // These are truthful and align with the chart.
    const merVals = attribSeries.map((d) => d.mer_w).filter((v) => isFinite(v));
    const roasVals = attribSeries.map((d) => d.roas_w).filter((v) => isFinite(v));
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    const median = (a: number[]) => {
      if (!a.length) return 0;
      const b = [...a].sort((x, y) => x - y);
      const mid = Math.floor(b.length / 2);
      return b.length % 2 ? b[mid] : (b[mid - 1] + b[mid]) / 2;
    };
    return {
      windowDays: attribWindowDays,
      spend,
      dateRange: `${primary.startISO} → ${primary.endISO}`,
      windowRange: `${primary.startISO} → ${endPlus}`,
      avgMerW: Number(avg(merVals).toFixed(2)),
      medMerW: Number(median(merVals).toFixed(2)),
      avgRoasW: Number(avg(roasVals).toFixed(2)),
      medRoasW: Number(median(roasVals).toFixed(2)),
    };
  }, [windows, attribWindowDays, spendSeries, attribSeries]);
  /** Print stylesheet for "Save as PDF" fallback */
  const PrintStyles = () => (
    <style jsx global>{`
      @media print {
        body {
          background: white !important;
        }
        .no-print {
          display: none !important;
        }
        #print-root {
          display: block !important;
        }
      }
      #print-root {
        display: none;
      }
    `}</style>
  );
  return (
    <DashboardLayout>
      <PrintStyles />
      <div className="p-6 md:p-8 min-w-0">
        <header className="no-print flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Media Dashboard</h1>
              <p className="mt-1 text-slate-600">Business-first view (Revenue, Orders, AOV, ASP) + ads as the lever</p>
              {effectiveShowComparison ? (
                <p className="mt-1 text-xs text-slate-500">Compare: {compareLabel} (dashed lines)</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Coverage: {coverageLabel}</p>
              )}
              {comparisonEnabled && !comparisonAvailable && compareDisabledReason ? (
                <p className="mt-1 text-xs text-amber-700">Comparison hidden: {compareDisabledReason}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              
              {/* Date Range Picker */}
              <DateRangePicker
                value={dateRangeValue}
                onChange={handleDateRangeChange}
                availableMinISO={undefined} // Can set if needed
                availableMaxISO={undefined} // Can set if needed
                comparisonEnabled={comparisonEnabled}
                onComparisonEnabledChange={setComparisonEnabled}
                compareMode={compareModeSetting}
                onCompareModeChange={setCompareModeSetting}
              />
              <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={showEventMarkers} onChange={(e) => setShowEventMarkers(e.target.checked)} />
                Show event markers
              </label>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  router.replace("/login");
                }}
                className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Logout
              </button>
            </div>
          </header>
          {/* North Star */}
          <section className="mt-6 overflow-hidden rounded-2xl border border-[#1f5fb8]/40 bg-gradient-to-br from-[#2B72D7] via-[#2568c8] to-[#1f5fb8] p-[1px] shadow-lg shadow-[#1f5fb8]/30">
            <div className="relative rounded-[14px] bg-gradient-to-br from-[#0b1e3c] via-[#0f2c55] to-[#12346a] px-5 py-5 sm:px-6 sm:py-6">
              <div className="absolute inset-0 opacity-60 mix-blend-screen" style={{ background: "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.05), transparent 35%), radial-gradient(circle at 80% 10%, rgba(37,104,200,0.22), transparent 30%), radial-gradient(circle at 40% 80%, rgba(31,95,184,0.18), transparent 32%)" }} />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="inline-flex items-center gap-2 self-start rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-100 ring-1 ring-white/10">
                    North Star
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(16,185,129,0.25)]" aria-hidden />
                  </div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-[0.08em] text-slate-300">{northStar.sub}</div>
                  <div className="text-4xl font-bold leading-tight text-white drop-shadow-sm">{loading ? "…" : northStar.primary}</div>
                  <div className="text-sm text-slate-200/80">{northStar.sub}</div>
                  <div className="text-sm text-slate-100/90">{loading ? "…" : northStar.details}</div>
                  {effectiveShowComparison && northStar.deltaLine ? (
                    <div className="text-xs text-slate-200/80">{northStar.deltaLine}</div>
                  ) : null}
                </div>
                <div className="relative flex flex-col items-end gap-3">
                  <span
                    className={[
                      "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-md shadow-black/30",
                      northStar.good ? "bg-emerald-500/90 text-white" : "bg-rose-500/90 text-white",
                    ].join(" ")}
                  >
                    <span className="h-2 w-2 rounded-full bg-white/90" aria-hidden />
                    {effectiveShowComparison ? (northStar.good ? "Trending up" : "Trending down") : "Live"}
                  </span>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                    Range: {range === "CUSTOM" ? `${customStartISO} → ${customEndISO}` : range}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                    Choose KPI:
                    <select
                      className="mt-1 w-full rounded-lg border border-white/20 bg-[#0f2c55]/90 px-2 py-1 text-xs text-slate-50 focus:border-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-200/40"
                      value={northStarKey}
                      onChange={(e) => setNorthStarKey(e.target.value)}
                    >
                      {kpis.map((k) => (
                        <option
                          key={k.label}
                          value={k.label}
                          className="bg-slate-900 text-slate-50"
                          style={{ backgroundColor: "#0f2c55", color: "#e2e8f0" }}
                        >
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {/* KPIs */}
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => {
              const hasTrend = typeof k.trend === "number" && Number.isFinite(k.trend);
              const clamped = hasTrend ? Math.max(-100, Math.min(100, k.trend as number)) : 0;
              const width = hasTrend ? Math.min(100, Math.abs(clamped)) : 0;
              const positive = clamped >= 0;
              const barGradient = positive
                ? "bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-400"
                : "bg-gradient-to-r from-rose-500 via-amber-500 to-amber-300";

              return (
                <div
                  key={k.label}
                  className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-slate-50 to-slate-100/60 p-5 shadow-md ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="pointer-events-none absolute inset-0 opacity-70">
                    <div className="absolute -left-6 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-blue-200/60 via-indigo-200/40 to-cyan-100/30 blur-3xl" />
                    <div className="absolute bottom-0 right-0 h-20 w-20 rounded-full bg-gradient-to-br from-slate-200/50 via-blue-100/40 to-white/60 blur-2xl" />
                  </div>

                  <div className="relative flex items-start justify-start">
                    <div className="text-sm font-semibold text-slate-800">{k.label}</div>
                  </div>

                  <div className="relative mt-3 flex items-baseline gap-2">
                    <div className="text-3xl font-bold text-slate-900">{loading ? "…" : k.value}</div>
                  </div>

                  <div className="relative mt-2 text-sm text-slate-600">
                    {renderSubText(k.label, k.sub)}
                  </div>

                  <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/70">
                    {hasTrend ? (
                      <div
                        className={`h-full ${barGradient} opacity-80 transition group-hover:opacity-95`}
                        style={{ width: `${width}%` }}
                        aria-label={`${k.label} change ${clamped.toFixed(1)}%`}
                      />
                    ) : null}
                  </div>
                  {hasTrend ? (
                    <div className="relative mt-1 text-[11px] font-semibold text-slate-600">
                      {clamped >= 0 ? "+" : ""}
                      {clamped.toFixed(1)}% vs prev
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
          {/* Settings: Cost Inputs */}
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900">Costs & margins</div>
                <div className="text-sm text-slate-500">
                  Manage your variable cost assumptions used for Contribution Profit and Profit Return.
                </div>
              </div>
              <Link
                href="/settings"
                className="rounded-xl bg-gradient-to-b from-[#2B72D7] to-[#1f5fb8] px-4 py-2 text-sm font-semibold text-white hover:bg-gradient-to-b hover:from-[#1f5fb8] hover:to-[#1a4a9a]"
              >
                Open Settings
              </Link>
            </div>
          </section>
          {/* Monthly Rollup Table */}
          <section className="mt-6 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-md">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 shadow-sm">
                  Monthly Performance
                </span>
                <div className="text-sm text-slate-600">
                  Shopify revenue & orders, Meta/Google spend, and KPIs
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                <span className="text-slate-600">Show</span>
                <select
                  value={monthlyMonths}
                  onChange={(e) => setMonthlyMonths(Number(e.target.value) || 6)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                  <option value={24}>24 months</option>
                  <option value={36}>36 months</option>
                </select>
              </div>
            </div>
            {monthlyError ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {monthlyError}
              </div>
            ) : null}
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[900px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-slate-700">Month</th>
                      <th className="px-3 py-3">Shopify Revenue</th>
                      <th className="px-3 py-3">Orders</th>
                      <th className="px-3 py-3">Meta Spend</th>
                      <th className="px-3 py-3">Google Spend</th>
                      <th className="px-3 py-3">Total Ad Spend</th>
                      <th className="px-3 py-3">True ROAS</th>
                      <th className="px-3 py-3">AOV</th>
                      <th className="px-3 py-3">CPO</th>
                      <th className="px-3 py-3">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlyLoading ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                          Loading monthly rollup…
                        </td>
                      </tr>
                    ) : monthlyRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                          No monthly rollup rows found yet.
                        </td>
                      </tr>
                    ) : (
                      monthlyRows.map((r) => (
                        <tr
                          key={r.month}
                          className="transition-colors hover:bg-slate-50"
                        >
                          <td className="sticky left-0 bg-white px-3 py-3 font-semibold text-slate-900 shadow-[4px_0_8px_-6px_rgba(0,0,0,0.08)]">
                            {r.month}
                          </td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("shopifyRevenue", r.shopifyRevenue), color: '#0f172a'}}>{formatCurrency(r.shopifyRevenue)}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("shopifyOrders", r.shopifyOrders), color: '#0f172a'}}>{formatNumber(r.shopifyOrders)}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("metaSpend", r.metaSpend), color: '#0f172a'}}>{formatCurrency(r.metaSpend)}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("googleSpend", r.googleSpend), color: '#0f172a'}}>{formatCurrency(r.googleSpend)}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("totalAdSpend", r.totalAdSpend), color: '#0f172a'}}>{formatCurrency(r.totalAdSpend)}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("trueRoas", r.trueRoas), color: '#0f172a'}}>{r.trueRoas != null ? `${r.trueRoas.toFixed(2)}x` : "—"}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("aov", r.aov), color: '#0f172a'}}>{r.aov != null ? formatCurrency(r.aov) : "—"}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("cpo", r.cpo), color: '#0f172a'}}>{r.cpo != null ? formatCurrency(r.cpo) : "—"}</td>
                          <td className="px-3 py-3 text-right" style={{...monthlyHeat.styleFor("profit", r.profit), color: '#0f172a'}}>{r.profit != null ? formatCurrency(r.profit) : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-blue-400" aria-hidden />
              <span>Profit uses your margin setting when available.</span>
            </div>
          </section>
          {/* Event Performance */}
          {effectiveShowComparison && lift.hasCompare && lift.compare ? (
            <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Event Performance</h2>
                  <p className="text-sm text-slate-600">
                    After change: <span className="font-medium text-slate-800">{lift.scopeStartISO}</span>–<span className="font-medium text-slate-800">{lift.scopeEndISO}</span>{" "}
                    <span className="text-slate-400">•</span>{" "}
                    Before change: {compareLabel.toLowerCase()} (same length)
                    {lift.scopeLabel ? <span className="ml-2 text-slate-500">Focused on: {lift.scopeLabel}</span> : null}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Tip: Use this to answer “what changed after we made the change?” not “what caused it”.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">Select Event:</span>
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 shadow-sm"
                      value={liftFocusEventId ?? ""}
                      onChange={(e) => {
                        const next = e.target.value ? e.target.value : null;
                        setLiftFocusEventId(next);
                        if (next) {
                          setComparisonEnabled(true);
                          setCompareModeSetting("previous_period");
                        }
                      }}
                    >
                      <option value="">—</option>
                      {eventsPrimary.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.event_date} • {ev.title || ev.type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setEventFormOpen(true)}
                    className="rounded-xl bg-gradient-to-b from-[#2B72D7] to-[#1f5fb8] px-4 py-2 text-sm font-semibold text-white hover:bg-gradient-to-b hover:from-[#1f5fb8] hover:to-[#1a4a9a]"
                  >
                    Add Event
                  </button>
                  {liftFocusEventId ? (
                    <>
                      <span className={["rounded-full px-3 py-1 text-xs font-semibold", conf.tone].join(" ")}>
                        Confidence: {conf.label} • {coverage.compareSales}/{rangeDays} days
                      </span>
                      <label className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={showAdvancedLift}
                          onChange={(e) => setShowAdvancedLift(e.target.checked)}
                        />
                        Advanced
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
              {/* Simple, client-friendly view - only show when event is selected */}
              {liftFocusEventId ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                      <div className="text-xs font-semibold text-slate-700">After the change</div>
                      <div className="mt-2 space-y-2 text-sm text-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Revenue</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.primary.revenue)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Orders</span>
                          <span className="font-semibold text-slate-900">{formatNumber(lift.primary.orders)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Avg selling price</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.primary.asp)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">AOV</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.primary.aov)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Profit</span>
                          <span className="font-semibold text-slate-900">
                            {lift.primary.profit == null ? "—" : formatCurrency(lift.primary.profit)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Profit Return</span>
                          <span className="font-semibold text-slate-900">
                            {lift.primary.profitReturnOnCosts == null ? "—" : `${lift.primary.profitReturnOnCosts.toFixed(2)}x`}
                          </span>
                        </div>
                        <div className="pt-2 text-[11px] text-slate-500">
                          Daily avg: {formatCurrency(lift.primary.revenue / Math.max(1, lift.days))} revenue •{" "}
                          {formatNumber(Math.round(lift.primary.orders / Math.max(1, lift.days)))} orders
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                      <div className="text-xs font-semibold text-slate-700">Before the change</div>
                      <div className="mt-2 space-y-2 text-sm text-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Revenue</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.compare.revenue)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Orders</span>
                          <span className="font-semibold text-slate-900">{formatNumber(lift.compare.orders)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Avg selling price</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.compare.asp)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">AOV</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(lift.compare.aov)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Profit</span>
                          <span className="font-semibold text-slate-900">
                            {lift.compare.profit == null ? "—" : formatCurrency(lift.compare.profit)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Profit Return</span>
                          <span className="font-semibold text-slate-900">
                            {lift.compare.profitReturnOnCosts == null ? "—" : `${lift.compare.profitReturnOnCosts.toFixed(2)}x`}
                          </span>
                        </div>
                        <div className="pt-2 text-[11px] text-slate-500">
                          Daily avg: {formatCurrency(lift.compare.revenue / Math.max(1, lift.days))} revenue •{" "}
                          {formatNumber(Math.round(lift.compare.orders / Math.max(1, lift.days)))} orders
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
                    <div className="text-xs font-semibold text-slate-700">What changed</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <LiftRow
                        label="Revenue"
                        value={`${formatSignedCurrency(lift.revenueLift)} (${compareFrac >= 0.95 ? formatSignedPct(lift.revenueLiftPct) : "—"})`}
                        good={lift.revenueLift >= 0}
                      />
                      <LiftRow
                        label="Orders"
                        value={`${formatSignedNumber(lift.ordersLift)} (${compareFrac >= 0.95 ? formatSignedPct(lift.ordersLiftPct) : "—"})`}
                        good={lift.ordersLift >= 0}
                      />
                      <LiftRow
                        label="Avg selling price"
                        value={`${formatSignedCurrency(lift.aspLift)} (${compareFrac >= 0.95 ? formatSignedPct(lift.aspLiftPct) : "—"})`}
                        good={lift.aspLift >= 0}
                      />
                      <LiftRow
                        label="AOV"
                        value={`${formatSignedCurrency(lift.aovLift)} (${compareFrac >= 0.95 ? formatSignedPct(lift.aovLiftPct) : "—"})`}
                        good={lift.aovLift >= 0}
                      />
                      <LiftRow
                        label="Profit"
                        value={
                          lift.profitLift == null
                            ? "—"
                            : `${formatSignedCurrency(lift.profitLift)} (${compareFrac >= 0.95 && lift.profitLiftPct != null ? formatSignedPct(lift.profitLiftPct) : "—"})`
                        }
                        good={lift.profitLift != null ? lift.profitLift >= 0 : true}
                      />
                      <LiftRow
                        label="Profit Return"
                        value={
                          lift.procLift == null
                            ? "—"
                            : `${(lift.procLift >= 0 ? "+" : "−")}${Math.abs(lift.procLift).toFixed(2)}x (${ 
                                compareFrac >= 0.95 && lift.procLiftPct != null ? formatSignedPct(lift.procLiftPct) : "—"
                              })`
                        }
                        good={lift.procLift != null ? lift.procLift >= 0 : true}
                      />
                    </div>
                    {compareFrac < 0.95 ? (
                      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
                        Some comparison days are missing, so % changes may be unreliable.
                      </div>
                    ) : null}
                  </div>
                </div>
                {/* Right rail: quick guidance */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold text-slate-600">How to read this</div>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    <li>
                      If <span className="font-semibold">revenue</span> and <span className="font-semibold">orders</span> go up, the change likely helped demand.
                    </li>
                    <li>
                      If <span className="font-semibold">avg item price</span> goes up but orders drop, you may be trading volume for price.
                    </li>
                    <li>
                      If <span className="font-semibold">revenue per $1 ad spend</span> drops, ads got less efficient (or spend rose faster than revenue).
                    </li>
                  </ul>
                  <div className="mt-4 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                    <div className="text-[11px] text-slate-500">Baseline context</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      Before: {formatCurrency(prevRevenue)} revenue • {formatNumber(prevOrders)} orders
                    </div>
                  </div>
                </div>
              </div>
              ) : null}
              {/* Advanced: decomposition + event windows */}
              {showAdvancedLift && liftFocusEventId ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {/* Event impact overlays */}
                  {eventImpact.has ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-semibold text-slate-700">Event window impact</div>
                          <div className="mt-1 text-sm text-slate-600">
                            {eventImpact.flaggedDays} day(s) fall within event impact windows in this range.
                          </div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
                          Inside share: {isFinite(eventImpact.insideShare) ? `${eventImpact.insideShare.toFixed(0)}%` : "—"}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                          <div className="text-xs font-semibold text-slate-700">During event windows</div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="text-sm text-slate-600">Revenue lift</div>
                            <div className="text-sm font-semibold text-slate-900">{formatSignedCurrency(eventImpact.insideLift)}</div>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="text-sm text-slate-600">Marketing Efficiency (MER) lift</div>
                            <div className="text-sm font-semibold text-slate-900">
                              {(eventImpact.insideMerLift >= 0 ? "+" : "−")}
                              {Math.abs(eventImpact.insideMerLift).toFixed(2)}x
                            </div>
                          </div>
                        </div>
                        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                          <div className="text-xs font-semibold text-slate-700">Outside event windows</div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="text-sm text-slate-600">Revenue lift</div>
                            <div className="text-sm font-semibold text-slate-900">{formatSignedCurrency(eventImpact.outsideLift)}</div>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="text-sm text-slate-600">Marketing Efficiency (MER) lift</div>
                            <div className="text-sm font-semibold text-slate-900">
                              {(eventImpact.outsideMerLift >= 0 ? "+" : "−")}
                              {Math.abs(eventImpact.outsideMerLift).toFixed(2)}x
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
                    <div className="text-xs font-semibold text-slate-600">Revenue decomposition (advanced)</div>
                    <LiftRow
                      label="Price effect"
                      value={formatSignedCurrency(lift.priceDriven)}
                      good={lift.priceDriven >= 0}
                      note="(ASP change × prior units)"
                    />
                    <LiftRow
                      label="Volume effect"
                      value={formatSignedCurrency(lift.volumeDriven)}
                      good={lift.volumeDriven >= 0}
                      note="(Unit change × prior ASP)"
                    />
                    <LiftRow
                      label="Interaction"
                      value={formatSignedCurrency(lift.interaction)}
                      good={lift.interaction >= 0}
                      note="(ASP & units changed together)"
                    />
                    <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                      <div className="text-[11px] text-slate-500">Checks out to total revenue change</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {formatSignedCurrency(lift.priceDriven + lift.volumeDriven + lift.interaction)}{" "}
                        <span className="text-slate-400 font-normal">≈</span>{" "}
                        {formatSignedCurrency(lift.revenueLift)}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-600">What to do</div>
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      <li>
                        <span className="font-semibold">Price effect up</span> → pricing/discounting/mix is helping. Protect margin.
                      </li>
                      <li>
                        <span className="font-semibold">Volume effect up</span> → demand likely improved. Lean into acquisition and check inventory.
                      </li>
                      <li>
                        <span className="font-semibold">Efficiency down</span> with revenue up → spend rose faster than revenue. Focus on incrementality, not only ROAS.
                      </li>
                    </ul>
                  </div>
                </div>
              ) : null}
              
              {/* Events List */}
              <div className="mt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Events</h3>
                    <p className="text-sm text-slate-600">Changes that can explain lift/drops in Revenue, ASP, and Profit Return.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {loading ? "…" : `${eventsToShow.length} shown`}
                  </span>
                </div>
                {range === "7D" && typeof events30Count === "number" && events30Count > 0 ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-700">
                      {showEvents30 ? (
                        <>
                          Showing <span className="font-semibold">last 30D</span> events.
                        </>
                      ) : (
                        <>
                          You have <span className="font-semibold">{events30Count}</span> event(s) in{" "}
                          <span className="font-semibold">last 30D</span>.
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowEvents30((v) => !v)}
                        className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        {showEvents30 ? "Show 7D only" : "Show last 30D"}
                      </button>
                      <button
                        onClick={() => setRange("30D")}
                        className="inline-flex items-center justify-center rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Switch range to 30D
                      </button>
                    </div>
                  </div>
                ) : null}
                {eventFormOpen && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600">Date</label>
                        <input
                          type="date"
                          value={newEventDate}
                          onChange={(e) => setNewEventDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600">Type</label>
                        <select
                          value={newEventType}
                          onChange={(e) => setNewEventType(e.target.value as any)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                        >
                          {EVENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600">Window (days)</label>
                        <input
                          inputMode="numeric"
                          value={newEventWindowDays}
                          onChange={(e) => setNewEventWindowDays(e.target.value)}
                          placeholder="7"
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                        />
                      </div>
                      <div className="sm:col-span-6">
                        <label className="block text-xs font-medium text-slate-600">Title</label>
                        <input
                          value={newEventTitle}
                          onChange={(e) => setNewEventTitle(e.target.value)}
                          placeholder="e.g. Increased budgets on top sellers"
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                        />
                      </div>
                      <div className="sm:col-span-6">
                        <label className="block text-xs font-medium text-slate-600">Notes (optional)</label>
                        <textarea
                          value={newEventNotes}
                          onChange={(e) => setNewEventNotes(e.target.value)}
                          rows={2}
                          placeholder="Optional context that will show in the event list + hover tooltip."
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                        />
                      </div>
                    </div>
                    {eventError && <div className="mt-3 text-sm text-red-600">{eventError}</div>}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={createEvent}
                        disabled={eventSaving || !clientId}
                        className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {eventSaving ? "Saving…" : "Save event"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEventFormOpen(false);
                          setEventError("");
                        }}
                        className="inline-flex items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  {!loading && eventsToShow.length === 0 && (
                    <div className="text-sm text-slate-500">
                      No events found in this view{range === "7D" ? " (try last 30D)." : "."}
                    </div>
                  )}
                  {eventsToShow.map((e) => (
                    <div key={e.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={liftFocusEventId === e.id}
                            onChange={(ev) => {
                              const checked = (ev.target as HTMLInputElement).checked;
                              const next = checked ? e.id : null;
                              setLiftFocusEventId(next);
                              if (next) {
                                setComparisonEnabled(true);
                                setCompareModeSetting("previous_period");
                              }
                            }}
                            title="Focus the summary on this change"
                          />
                          <div className="font-semibold text-slate-900">{e.title}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-slate-600">
                            {(e.event_date || "").slice(0, 10)} • <span className="font-medium">{e.type}</span>
                            {e.impact_window_days ? ` • ${e.impact_window_days}d window` : ""}
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteEvent(e.id)}
                            disabled={eventSaving}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                            title="Delete event"
                            aria-label="Delete event"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {e.notes && <div className="mt-2 text-sm text-slate-700">{e.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
{/* Spend + pie */}
          <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Ad Spend Trend</h2>
                  <p className="text-sm text-slate-600">Daily ad spend ({rangeDays} days)</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showTotalSpend}
                      onChange={(e) => setShowTotalSpend(e.target.checked)}
                      className="w-3 h-3 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Total</span>
                  </label>
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showMetaSpend}
                      onChange={(e) => setShowMetaSpend(e.target.checked)}
                      className="w-3 h-3 text-green-600 bg-slate-100 border-slate-300 rounded focus:ring-green-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Meta</span>
                  </label>
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showGoogleSpend}
                      onChange={(e) => setShowGoogleSpend(e.target.checked)}
                      className="w-3 h-3 text-amber-600 bg-slate-100 border-slate-300 rounded focus:ring-amber-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Google</span>
                  </label>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">Spend</span>
                </div>
              </div>
              <ChartReadyWrapper minHeight={320} className="mt-4 w-full">
                {spendChartRows.length > 0 ? (
                  <MultiSeriesEventfulLineChart
                    data={spendChartRows}
                    compareData={spendChartDataCompare}
                    showComparison={effectiveShowComparison}
                    series={spendChartSeries}
                    yTooltipFormatter={(v) => formatCurrency(v)}
                    markers={eventMarkers}
                    showMarkers={showEventMarkers}
                    xDomain={xDomain}
                    compareLabel={compareLabel}
                  />
                ) : null}
              </ChartReadyWrapper>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white shadow-md min-w-0">
              <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 shadow-sm">
                    Channel Mix
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Spend by Channel</h2>
                    <p className="text-xs text-slate-600">Distribution • {rangeDays} days • Total: {formatCurrency(adTotals.spend)}</p>
                  </div>
                </div>
              </div>
              <div className="relative p-5">
                <div className="absolute inset-0 opacity-30 mix-blend-multiply" style={{ background: "radial-gradient(circle at 50% 50%, rgba(59,130,246,0.08), transparent 60%)" }} />
                <div className="relative w-full h-[320px] min-h-[320px]">
                  <SafeResponsiveContainer height={320} className="h-full w-full">
                    <PieChart>
                      <defs>
                        <filter id="pieGlow">
                          <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
                          <feComponentTransfer>
                            <feFuncA type="linear" slope="0.5" />
                          </feComponentTransfer>
                        </filter>
                      </defs>
                      <Pie 
                        data={spendByChannel} 
                        dataKey="value" 
                        nameKey="name" 
                        innerRadius={60} 
                        outerRadius={90} 
                        paddingAngle={3}
                        stroke="#fff"
                        strokeWidth={2}
                      >
                        {spendByChannel.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(v) => formatCurrency(Number(v))} 
                        contentStyle={{ 
                          backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                          border: '1px solid #e2e8f0', 
                          borderRadius: '8px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <Legend 
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '16px' }}
                        formatter={(value) => <span className="text-sm font-medium text-slate-700">{value}</span>}
                      />
                    </PieChart>
                  </SafeResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
          {/* Profit + Revenue + efficiency */}
          <section className="mt-6 grid grid-cols-1 gap-6">
            <ChartCard
              title="Profit Trend"
              subtitle={`Estimated profit (after costs & ad spend • ${profitRollingEnabled ? `rolling ${profitRollingWindowDays}d` : "daily"} • ${rangeDays} days)`}
              badge="Profit"
            >
              {marginAfterCostsPct == null ? (
                <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
                  Add your margin in settings to see Profit.
                </div>
              ) : null}
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={profitRollingEnabled}
                    onChange={(e) => setProfitRollingEnabled(e.target.checked)}
                  />
                  Rolling
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-slate-500">Window</span>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={profitRollingWindowDays}
                    onChange={(e) => setProfitRollingWindowDays(Number(e.target.value))}
                    disabled={!profitRollingEnabled}
                  >
                    <option value={3}>3d</option>
                    <option value={7}>7d</option>
                    <option value={14}>14d</option>
                    <option value={30}>30d</option>
                  </select>
                </label>
              </div>
              <ChartReadyWrapper minHeight={320} className="w-full">
                <EventfulLineChart
                  data={profitTrendSeries}
                  compareData={profitTrendSeriesCompare}
                  showComparison={effectiveShowComparison}
                  yKey="profit"
                  yTooltipFormatter={(v) => formatCurrency(v)}
                  markers={eventMarkers}
                  showMarkers={showEventMarkers}
                  xDomain={xDomain}
                  compareLabel={compareLabel}
                />
              </ChartReadyWrapper>
            </ChartCard>
            <ChartCard
              title="Revenue Trend"
              subtitle={`Daily revenue (${revenueRollingEnabled ? `rolling ${revenueRollingWindowDays}d` : "daily"} • ${rangeDays} days)`}
              badge="Revenue"
            >
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={revenueRollingEnabled}
                    onChange={(e) => setRevenueRollingEnabled(e.target.checked)}
                    className="w-3 h-3 text-slate-600 bg-slate-100 border-slate-300 rounded focus:ring-slate-500 focus:ring-2"
                  />
                  <span className="text-slate-700">Rolling</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-slate-500">Window</span>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={revenueRollingWindowDays}
                    onChange={(e) => setRevenueRollingWindowDays(Number(e.target.value))}
                    disabled={!revenueRollingEnabled}
                  >
                    <option value={3}>3d</option>
                    <option value={7}>7d</option>
                    <option value={14}>14d</option>
                    <option value={30}>30d</option>
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showShopifyRevenue}
                      onChange={(e) => setShowShopifyRevenue(e.target.checked)}
                      className="w-3 h-3 text-green-600 bg-slate-100 border-slate-300 rounded focus:ring-green-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Shopify Total</span>
                  </label>
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showGoogleRevenue}
                      onChange={(e) => setShowGoogleRevenue(e.target.checked)}
                      className="w-3 h-3 text-amber-600 bg-slate-100 border-slate-300 rounded focus:ring-amber-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Google</span>
                  </label>
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={showMetaRevenue}
                      onChange={(e) => setShowMetaRevenue(e.target.checked)}
                      className="w-3 h-3 text-purple-600 bg-slate-100 border-slate-300 rounded focus:ring-purple-500 focus:ring-2"
                    />
                    <span className="text-slate-700">Meta</span>
                  </label>
                </div>
              </div>
              <ChartReadyWrapper minHeight={320} className="w-full">
                {revenueChartRows.length > 0 ? (
                  <MultiSeriesEventfulLineChart
                    data={revenueChartRows}
                    compareData={revenueChartDataCompare}
                    showComparison={effectiveShowComparison}
                    series={revenueChartSeries}
                    yTooltipFormatter={(v) => formatCurrency(v)}
                    markers={eventMarkers}
                    showMarkers={showEventMarkers}
                    xDomain={xDomain}
                    compareLabel={compareLabel}
                  />
                ) : null}
              </ChartReadyWrapper>
            </ChartCard>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartCard
                title="ASP Trend"
                subtitle={`Average selling price (Revenue ÷ Units • ${aspRollingEnabled ? `rolling ${aspRollingWindowDays}d` : "daily"} • ${rangeDays} days)`}
                badge="ASP"
              >
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={aspRollingEnabled}
                    onChange={(e) => setAspRollingEnabled(e.target.checked)}
                  />
                  Rolling
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-slate-500">Window</span>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={aspRollingWindowDays}
                    onChange={(e) => setAspRollingWindowDays(Number(e.target.value))}
                    disabled={!aspRollingEnabled}
                  >
                    <option value={3}>3d</option>
                    <option value={7}>7d</option>
                    <option value={14}>14d</option>
                    <option value={30}>30d</option>
                  </select>
                </label>
              </div>
                <ChartReadyWrapper minHeight={320} className="w-full">
                  <EventfulLineChart
                    data={aspTrendSeries}
                    compareData={aspTrendSeriesCompare}
                    showComparison={effectiveShowComparison}
                    yKey="asp"
                    yTooltipFormatter={(v) => formatCurrency(v)}
                    markers={eventMarkers}
                    showMarkers={showEventMarkers}
                    xDomain={xDomain}
                    compareLabel={compareLabel}
                  />
                </ChartReadyWrapper>
              </ChartCard>
              <ChartCard
                title="Profit Return Trend"
                subtitle={`Revenue ÷ total costs (${merRollingEnabled ? `rolling ${merRollingWindowDays}d` : "daily"} • ${rangeDays} days)`}
                badge="Profit Return"
              >
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={merRollingEnabled}
                      onChange={(e) => setMerRollingEnabled(e.target.checked)}
                    />
                    Rolling
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-slate-500">Window</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                      value={merRollingWindowDays}
                      onChange={(e) => setMerRollingWindowDays(Number(e.target.value))}
                      disabled={!merRollingEnabled}
                    >
                      <option value={3}>3d</option>
                      <option value={7}>7d</option>
                      <option value={14}>14d</option>
                      <option value={30}>30d</option>
                    </select>
                  </label>
                </div>
                <ChartReadyWrapper minHeight={320} className="w-full">
                  <EventfulLineChart
                    data={profitReturnTrendSeries}
                    compareData={profitReturnTrendSeriesCompare}
                    showComparison={effectiveShowComparison}
                    yKey="mer"
                    yTooltipFormatter={(v) => `${Number(v).toFixed(2)}x`}
                    markers={eventMarkers}
                    showMarkers={showEventMarkers}
                    xDomain={xDomain}
                    compareLabel={compareLabel}
                  />
                </ChartReadyWrapper>
              </ChartCard>
            </div>
          </section>
          {/* Profit Return vs ROAS Attribution Window */}
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Attribution: Profit Return vs ROAS</h2>
                <p className="text-sm text-slate-600">
                  Compare business truth (Profit Return) vs tracked ad return (ROAS) under a {attribWindowDays}-day forward window.
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Chart uses forward revenue window per day divided by that day’s spend (useful for explaining lag).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  <span className="text-slate-500">Window</span>
                  <select
                    value={attribWindowDays}
                    onChange={(e) => setAttribWindowDays(Number(e.target.value) as AttributionWindowDays)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                  </select>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Avg Profit Return (w): {attributionSummary.avgMerW}x • Avg ROAS(w): {attributionSummary.avgRoasW}x
                </span>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm font-semibold text-slate-900">Daily windowed lines</div>
                <div className="mt-1 text-sm text-slate-600">Profit Return (w) and ROAS(w) over time</div>
                <div className="mt-3 w-full h-[320px] min-h-[320px]">
                  <SafeResponsiveContainer height={320} className="h-full w-full">
                    <LineChart
                      data={attribSeries.map((d) => ({
                        ...d,
                        ts: isoToTsUTC(d.date),
                      }))}
                    >
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={xDomain}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => mmdd(new Date(Number(v)).toISOString().slice(0, 10))}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(v: any, name: any) => {
                          // name comes from <Line name="..." />
                          return [`${Number(v).toFixed(2)}x`, String(name)];
                        }}
                        labelFormatter={(label: any) => {
                          const iso = new Date(Number(label)).toISOString().slice(0, 10);
                          return `${mmdd(iso)} (${iso})`;
                        }}
                      />
                      <Legend
                        formatter={(value: any) => String(value)}
                        wrapperStyle={{ fontSize: 12 }}
                      />
                        <Line type="monotone" dataKey="mer_w" name="Profit Return (windowed)" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="roas_w" name="ROAS (windowed)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </SafeResponsiveContainer>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  Interpretation: if Profit Return (w) is consistently above ROAS(w), revenue is being driven by more than
                  tracked last-click/attributed conversions.
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm font-semibold text-slate-900">Scatter: Profit Return (w) vs ROAS(w)</div>
                <div className="mt-1 text-sm text-slate-600">Each dot is a day in the selected date range</div>
                <div className="mt-3 w-full h-[320px] min-h-[320px]">
                  <SafeResponsiveContainer height={320} className="h-full w-full">
                    <LineChart
                      data={attribSeries.map((d) => ({
                        x: d.roas_w,
                        y: d.mer_w,
                      }))}
                    >
                      <XAxis
                        dataKey="x"
                        tick={{ fontSize: 12 }}
                        label={{ value: "ROAS (windowed)", position: "insideBottom", offset: -5 }}
                      />
                      <YAxis
                        dataKey="y"
                        tick={{ fontSize: 12 }}
                        label={{ value: "Profit Return (windowed)", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload;
                          const x = Number(p?.x ?? 0);
                          const y = Number(p?.y ?? 0);
                          return (
                            <div className="rounded-xl bg-slate-900 text-white shadow-xl ring-1 ring-white/10 px-3 py-2">
                              <div className="text-xs text-slate-300">Windowed ratios</div>
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="text-xs text-slate-300">ROAS (w)</div>
                                  <div className="text-sm font-semibold">{x.toFixed(2)}x</div>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <div className="text-xs text-slate-300">Profit Return (w)</div>
                                  <div className="text-sm font-semibold">{y.toFixed(2)}x</div>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      />
                        <Scatter
                          data={attribSeries.map((d) => ({ x: d.roas_w, y: d.mer_w }))}
                          dataKey="y"
                          isAnimationActive={false}
                        />
                    </LineChart>
                  </SafeResponsiveContainer>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  This helps explain when “ROAS looks fine” but “Profit Return deteriorates” (or vice versa).
                </div>
              </div>
            </div>
          </section>
      </div>
    </DashboardLayout>
  );
}
/** -----------------------------
 *  Small UI components
 *  ----------------------------- */
function LiftRow({
  label,
  value,
  good,
  note,
}: {
  label: string;
  value: string;
  good: boolean;
  note?: string;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {note ? <div className="text-[11px] text-slate-500">{note}</div> : null}
      </div>
      <div className={["text-sm font-semibold", good ? "text-emerald-700" : "text-rose-700"].join(" ")}>{value}</div>
    </div>
  );
}
function NavItem({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active?: boolean;
}) {
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
function RangePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-lg px-3 py-2 text-sm font-medium",
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
function ChartCard({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 min-w-0">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600">{subtitle}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{badge}</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
function MiniKPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
  
}
