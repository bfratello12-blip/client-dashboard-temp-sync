"use client";

import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

export const dynamic = "force-dynamic";

/**
 * Preview-only page for the redesigned line/area chart styling.
 * URL: /preview/charts
 *
 * Nothing here is wired to live data or live components. The goal is to
 * approve the visual direction before porting it into
 *   - EventfulLineChart
 *   - MultiSeriesEventfulLineChart
 * inside app/page.client.tsx.
 */

// ---------- sample data ----------
function makeSeries(days: number, base: number, variance: number, drift: number) {
  const out: { date: string; ts: number; revenue: number; spend: number; profit: number }[] = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days + 1);
  let r = base;
  let s = base * 0.55;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    r += (Math.random() - 0.45) * variance + drift;
    s += (Math.random() - 0.5) * variance * 0.7 + drift * 0.5;
    const revenue = Math.max(0, r + Math.sin(i / 4) * variance * 0.6);
    const spend = Math.max(0, s + Math.cos(i / 5) * variance * 0.4);
    out.push({
      date: iso,
      ts: d.getTime(),
      revenue: Math.round(revenue),
      spend: Math.round(spend),
      profit: Math.round(revenue - spend),
    });
  }
  return out;
}

const mmdd = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

const fmtUsd = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(v) ? v : 0);

const compactNum = (n: number) => {
  if (!isFinite(n)) return "";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (Math.abs(n) < 10) return n.toFixed(1);
  return Math.round(n).toString();
};

// ---------- redesigned tooltip ----------
function CleanTooltip({
  active,
  label,
  payload,
  valueFormatter,
}: {
  active?: boolean;
  label?: any;
  payload?: any[];
  valueFormatter: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const dateLabel =
    typeof label === "number"
      ? new Date(label).toISOString().slice(0, 10)
      : String(label ?? "");
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.25)] backdrop-blur">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {mmdd(dateLabel)}
      </div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-slate-600">{p.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-900">
              {valueFormatter(Number(p.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- LIVE-STYLE chart (matches current production look) ----------
function LiveStyleChart({
  data,
  series,
  height = 320,
}: {
  data: any[];
  series: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-2.5 shadow-[0_16px_36px_-26px_rgba(15,23,42,0.5)]"
      style={{ height }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_1px_1px,#dbe2ee_1px,transparent_0)] [background-size:24px_24px] opacity-25" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-cyan-50/65 to-transparent" />
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 20, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#94a3b8" strokeDasharray="3 6" strokeOpacity={0.24} vertical={false} />
          <defs>
            {series.map((s) => (
              <React.Fragment key={s.key}>
                <linearGradient id={`live-stroke-${s.key}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                  <stop offset="50%" stopColor={s.color} stopOpacity={0.65} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={1} />
                </linearGradient>
                <linearGradient id={`live-fill-${s.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="50%" stopColor={s.color} stopOpacity={0.1} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              </React.Fragment>
            ))}
          </defs>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v) => mmdd(new Date(Number(v)).toISOString().slice(0, 10))}
            interval="preserveStartEnd"
            minTickGap={20}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1", strokeOpacity: 0.45 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1", strokeOpacity: 0.45 }}
            tickFormatter={(v) => compactNum(Number(v))}
          />
          <Tooltip
            content={(p: any) => (
              <CleanTooltip active={p.active} label={p.label} payload={p.payload} valueFormatter={fmtUsd} />
            )}
            cursor={{ stroke: "#64748b", strokeDasharray: "4 6", strokeOpacity: 0.45 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ paddingBottom: 8 }}
            formatter={(value) => <span className="text-xs font-medium text-slate-600">{value}</span>}
          />
          {series.map((s) => (
            <Area
              key={`area-${s.key}`}
              type="linear"
              dataKey={s.key}
              fill={`url(#live-fill-${s.key})`}
              stroke="none"
              isAnimationActive={false}
              connectNulls
              fillOpacity={1}
              legendType="none"
            />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={`url(#live-stroke-${s.key})`}
              strokeWidth={2.1}
              dot={false}
              connectNulls
              strokeLinecap="round"
              strokeLinejoin="round"
              activeDot={{ r: 4.5, stroke: s.color, strokeWidth: 1.75, fill: "#f8fafc" }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- REDESIGNED chart (proposed) ----------
function RedesignedChart({
  data,
  series,
  height = 320,
}: {
  data: any[];
  series: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.18)]"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 4 }}>
          <defs>
            {series.map((s) => (
              <React.Fragment key={s.key}>
                <linearGradient id={`new-fill-${s.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                  <stop offset="80%" stopColor={s.color} stopOpacity={0.0} />
                </linearGradient>
                <filter id={`new-shadow-${s.key}`} x="-10%" y="-20%" width="120%" height="140%">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
                  <feOffset dx="0" dy="1.5" result="offsetblur" />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope="0.18" />
                  </feComponentTransfer>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </React.Fragment>
            ))}
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeOpacity={0.7} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11, fill: "#94a3b8", fontVariantNumeric: "tabular-nums" }}
            tickFormatter={(v) => mmdd(new Date(Number(v)).toISOString().slice(0, 10))}
            interval="preserveStartEnd"
            minTickGap={36}
            tickLine={false}
            axisLine={false}
            dy={6}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#94a3b8", fontVariantNumeric: "tabular-nums" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => compactNum(Number(v))}
            width={44}
          />
          <Tooltip
            content={(p: any) => (
              <CleanTooltip active={p.active} label={p.label} payload={p.payload} valueFormatter={fmtUsd} />
            )}
            cursor={{ stroke: "#475569", strokeWidth: 1, strokeOpacity: 0.35 }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ paddingBottom: 12 }}
            formatter={(value) => (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{value}</span>
            )}
          />
          {series.map((s) => (
            <Area
              key={`area-${s.key}`}
              type="monotone"
              dataKey={s.key}
              fill={`url(#new-fill-${s.key})`}
              stroke="none"
              isAnimationActive={false}
              connectNulls
              fillOpacity={1}
              legendType="none"
            />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={false}
              filter={`url(#new-shadow-${s.key})`}
              activeDot={{
                r: 5,
                stroke: "#ffffff",
                strokeWidth: 2,
                fill: s.color,
              }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- page ----------
export default function ChartsPreviewPage() {
  const [days, setDays] = useState(45);
  const data = useMemo(() => makeSeries(days, 1800, 320, 8), [days]);

  const singleSeries = [{ key: "revenue", name: "Revenue", color: "#2563eb" }];
  const multiSeries = [
    { key: "revenue", name: "Revenue", color: "#2563eb" },
    { key: "spend", name: "Ad Spend", color: "#f59e0b" },
    { key: "profit", name: "Profit", color: "#10b981" },
  ];

  return (
    <div className="min-h-screen bg-slate-50/60 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">
            Internal preview
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Line chart redesign — before / after
          </h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Sample data only. Confirm the redesigned look (right column / bottom),
            then I'll port the same styling into <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">EventfulLineChart</code>{" "}
            and <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">MultiSeriesEventfulLineChart</code>{" "}
            in the live dashboard.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs font-medium text-slate-500">Sample window:</span>
            {[14, 30, 45, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  days === d
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Single series — Revenue
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-500">Current (live)</div>
              <LiveStyleChart data={data} series={singleSeries} />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-blue-600">Redesigned</div>
              <RedesignedChart data={data} series={singleSeries} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Multi series — Revenue / Spend / Profit
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-500">Current (live)</div>
              <LiveStyleChart data={data} series={multiSeries} height={340} />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-blue-600">Redesigned</div>
              <RedesignedChart data={data} series={multiSeries} height={340} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            What's changed (redesigned)
          </h2>
          <ul className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Smooth <code>monotone</code> curves instead of jagged linear segments
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Solid brand stroke per series — no more uneven horizontal gradient
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Subtle SVG drop-shadow under lines for depth without noise
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Lighter area fill (18% → 0%), less competing with the line
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Cleaner gridlines, no axis lines, tabular numerals on ticks
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Removed polka-dot background and cyan top wash
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Tooltip: compact card, currency aligned right, monospace numerals
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Active dot: solid color with white halo (more “Vercel/Linear” feel)
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
