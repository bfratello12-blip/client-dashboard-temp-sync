"use client";

import React, { useMemo, useState } from "react";

export const dynamic = "force-dynamic";

/**
 * Preview-only page for the redesigned Monthly Performance table.
 * URL: /preview/monthly-table
 */

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

// ---------- helpers ----------
const fmtUsd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
};
const fmtNum = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US").format(v);
};
const fmtRoas = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`;

function makeSampleRows(months: number): MonthlyRow[] {
  const out: MonthlyRow[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const label = d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    const seasonality = 1 + Math.sin((d.getUTCMonth() / 12) * Math.PI * 2) * 0.25;
    const growth = 1 + (months - i) * 0.04;
    const revenue = Math.round(48000 * seasonality * growth + Math.random() * 6000);
    const orders = Math.round(620 * seasonality * growth + Math.random() * 80);
    const meta = Math.round(6800 * seasonality + Math.random() * 800);
    const google = Math.round(5200 * seasonality + Math.random() * 700);
    const spend = meta + google;
    const aov = revenue / Math.max(1, orders);
    const cpo = spend / Math.max(1, orders);
    const profit = Math.round(revenue * 0.32 - spend);
    out.push({
      month: label,
      shopifyRevenue: revenue,
      shopifyOrders: orders,
      metaSpend: meta,
      googleSpend: google,
      totalAdSpend: spend,
      trueRoas: revenue / Math.max(1, spend),
      aov,
      cpo,
      profit,
    });
  }
  return out;
}

// ---------- LIVE-STYLE table (current production look) ----------
function LiveStyleTable({ rows }: { rows: MonthlyRow[] }) {
  const monthlyHeat = useMemo(() => {
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
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
      let min = Infinity;
      let max = -Infinity;
      for (const r of rows) {
        const v = (r as any)[k];
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      stats[k] = { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
    }
    const perfRgb = { r: 59, g: 130, b: 246 };
    const neutralRgb = { r: 148, g: 163, b: 184 };
    return (key: typeof keys[number], value: number | null) => {
      if (value == null) return undefined;
      const { min, max } = stats[key] || { min: 0, max: 0 };
      const denom = max - min;
      const t = denom === 0 ? 0 : clamp01((value - min) / denom);
      const isSpend = key === "metaSpend" || key === "googleSpend" || key === "totalAdSpend";
      const rgb = isSpend ? neutralRgb : perfRgb;
      const a = isSpend ? 0.10 + t * 0.32 : 0.06 + t * 0.34;
      return { backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})` } as const;
    };
  }, [rows]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 shadow-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-100 shadow-sm ring-1 ring-slate-700/60">
            Monthly Performance
          </span>
          <div className="text-sm text-slate-400">
            Shopify revenue & orders, Meta/Google spend, and KPIs
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[900px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-slate-900/90 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                <th className="sticky left-0 z-20 bg-slate-900/90 px-3 py-3 text-slate-200">Month</th>
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
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr
                  key={r.month}
                  className="transition-colors odd:bg-slate-950 even:bg-slate-900/30 hover:bg-slate-900/60"
                >
                  <td className="sticky left-0 bg-slate-950 px-3 py-3 font-semibold text-slate-100 shadow-[4px_0_8px_-6px_rgba(0,0,0,0.3)]">
                    {r.month}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-100" style={monthlyHeat("shopifyRevenue", r.shopifyRevenue)}>{fmtUsd(r.shopifyRevenue)}</td>
                  <td className="px-3 py-3 text-right text-slate-200" style={monthlyHeat("shopifyOrders", r.shopifyOrders)}>{fmtNum(r.shopifyOrders)}</td>
                  <td className="px-3 py-3 text-right text-slate-300" style={monthlyHeat("metaSpend", r.metaSpend)}>{fmtUsd(r.metaSpend)}</td>
                  <td className="px-3 py-3 text-right text-slate-300" style={monthlyHeat("googleSpend", r.googleSpend)}>{fmtUsd(r.googleSpend)}</td>
                  <td className="px-3 py-3 text-right text-slate-200" style={monthlyHeat("totalAdSpend", r.totalAdSpend)}>{fmtUsd(r.totalAdSpend)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-100" style={monthlyHeat("trueRoas", r.trueRoas)}>{fmtRoas(r.trueRoas)}</td>
                  <td className="px-3 py-3 text-right text-slate-200" style={monthlyHeat("aov", r.aov)}>{r.aov != null ? fmtUsd(r.aov) : "—"}</td>
                  <td className="px-3 py-3 text-right text-slate-200" style={monthlyHeat("cpo", r.cpo)}>{r.cpo != null ? fmtUsd(r.cpo) : "—"}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-100" style={monthlyHeat("profit", r.profit)}>{r.profit != null ? fmtUsd(r.profit) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------- REDESIGNED table ----------
function TrendDelta({ current, previous, invert = false }: { current: number | null; previous: number | null | undefined; invert?: boolean }) {
  if (current == null || previous == null || previous === 0) {
    return <span className="text-[10px] font-medium text-slate-300">—</span>;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct)) return <span className="text-[10px] font-medium text-slate-300">—</span>;
  const isUp = pct > 0;
  const isGood = invert ? !isUp : isUp;
  const arrow = isUp ? "▲" : pct < 0 ? "▼" : "·";
  const cls = Math.abs(pct) < 0.5
    ? "text-slate-400"
    : isGood
      ? "text-emerald-600"
      : "text-rose-500";
  return (
    <span className={`text-[10px] font-semibold tabular-nums ${cls}`}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function HeatBar({ value, min, max, color = "blue" }: { value: number | null; min: number; max: number; color?: "blue" | "slate" | "emerald" }) {
  if (value == null) return null;
  const denom = max - min;
  const t = denom === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / denom));
  const palette = {
    blue: "bg-blue-500/70",
    slate: "bg-slate-400/60",
    emerald: "bg-emerald-500/70",
  }[color];
  return (
    <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${palette}`} style={{ width: `${Math.max(4, t * 100)}%` }} />
    </div>
  );
}

function RedesignedTable({ rows }: { rows: MonthlyRow[] }) {
  // chronological for trend deltas (rows come most-recent-first)
  const chronological = useMemo(() => [...rows].reverse(), [rows]);
  const indexByMonth = useMemo(() => {
    const m = new Map<string, number>();
    chronological.forEach((r, i) => m.set(r.month, i));
    return m;
  }, [chronological]);

  const stats = useMemo(() => {
    const keys: (keyof MonthlyRow)[] = [
      "shopifyRevenue",
      "shopifyOrders",
      "metaSpend",
      "googleSpend",
      "totalAdSpend",
      "trueRoas",
      "aov",
      "cpo",
      "profit",
    ];
    const out: Record<string, { min: number; max: number }> = {};
    for (const k of keys) {
      let min = Infinity;
      let max = -Infinity;
      for (const r of rows) {
        const v = r[k] as number | null;
        if (v == null || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[k as string] = { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
    }
    return out;
  }, [rows]);

  const totals = useMemo(() => {
    const sum = (k: keyof MonthlyRow) =>
      rows.reduce((a, r) => a + ((r[k] as number | null) ?? 0), 0);
    const totalRev = sum("shopifyRevenue");
    const totalOrders = sum("shopifyOrders");
    const totalSpend = sum("totalAdSpend");
    return {
      shopifyRevenue: totalRev,
      shopifyOrders: totalOrders,
      metaSpend: sum("metaSpend"),
      googleSpend: sum("googleSpend"),
      totalAdSpend: totalSpend,
      trueRoas: totalSpend > 0 ? totalRev / totalSpend : null,
      aov: totalOrders > 0 ? totalRev / totalOrders : null,
      cpo: totalOrders > 0 ? totalSpend / totalOrders : null,
      profit: rows.reduce((a, r) => a + (r.profit ?? 0), 0),
    };
  }, [rows]);

  const prevFor = (month: string, key: keyof MonthlyRow): number | null => {
    const idx = indexByMonth.get(month);
    if (idx == null || idx === 0) return null;
    const prev = chronological[idx - 1];
    const v = prev?.[key] as number | null;
    return v == null || !Number.isFinite(v) ? null : v;
  };

  const headerCell = "px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.18)]">
      {/* Header strip */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
            <h3 className="text-sm font-semibold text-slate-900">Monthly Performance</h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Revenue, orders, ad spend and profitability — month over month
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" />
            Performance
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-slate-400/60" />
            Spend
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/70" />
            Profit
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-slate-50/70">
              <th className="sticky left-0 z-10 bg-slate-50/95 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">
                Month
              </th>
              <th className={headerCell}>Revenue</th>
              <th className={headerCell}>Orders</th>
              <th className={headerCell}>Meta</th>
              <th className={headerCell}>Google</th>
              <th className={headerCell}>Ad Spend</th>
              <th className={headerCell}>ROAS</th>
              <th className={headerCell}>AOV</th>
              <th className={headerCell}>CPO</th>
              <th className={`${headerCell} pr-5`}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isFirst = idx === 0;
              return (
                <tr
                  key={r.month}
                  className="group border-t border-slate-100 transition-colors hover:bg-blue-50/30"
                >
                  <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-4 py-3 text-left align-middle font-semibold text-slate-900 group-hover:bg-blue-50/30">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 group-hover:bg-blue-500" />
                      {r.month}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right align-top">
                    <div className="font-semibold tabular-nums text-slate-900">{fmtUsd(r.shopifyRevenue)}</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5">
                      <TrendDelta current={r.shopifyRevenue} previous={prevFor(r.month, "shopifyRevenue")} />
                    </div>
                    <HeatBar value={r.shopifyRevenue} min={stats.shopifyRevenue.min} max={stats.shopifyRevenue.max} color="blue" />
                  </td>

                  <td className="px-3 py-3 text-right align-top">
                    <div className="tabular-nums text-slate-700">{fmtNum(r.shopifyOrders)}</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5">
                      <TrendDelta current={r.shopifyOrders} previous={prevFor(r.month, "shopifyOrders")} />
                    </div>
                    <HeatBar value={r.shopifyOrders} min={stats.shopifyOrders.min} max={stats.shopifyOrders.max} color="blue" />
                  </td>

                  <td className="px-3 py-3 text-right align-top tabular-nums text-slate-600">
                    {fmtUsd(r.metaSpend)}
                    <HeatBar value={r.metaSpend} min={stats.metaSpend.min} max={stats.metaSpend.max} color="slate" />
                  </td>

                  <td className="px-3 py-3 text-right align-top tabular-nums text-slate-600">
                    {fmtUsd(r.googleSpend)}
                    <HeatBar value={r.googleSpend} min={stats.googleSpend.min} max={stats.googleSpend.max} color="slate" />
                  </td>

                  <td className="px-3 py-3 text-right align-top">
                    <div className="tabular-nums text-slate-700">{fmtUsd(r.totalAdSpend)}</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5">
                      <TrendDelta current={r.totalAdSpend} previous={prevFor(r.month, "totalAdSpend")} invert />
                    </div>
                    <HeatBar value={r.totalAdSpend} min={stats.totalAdSpend.min} max={stats.totalAdSpend.max} color="slate" />
                  </td>

                  <td className="px-3 py-3 text-right align-top">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                        (r.trueRoas ?? 0) >= 3
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : (r.trueRoas ?? 0) >= 2
                            ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100"
                            : "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
                      }`}
                    >
                      {fmtRoas(r.trueRoas)}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right align-top tabular-nums text-slate-700">
                    {r.aov != null ? fmtUsd(r.aov) : "—"}
                  </td>

                  <td className="px-3 py-3 text-right align-top tabular-nums text-slate-700">
                    {r.cpo != null ? fmtUsd(r.cpo) : "—"}
                  </td>

                  <td className="pr-5 pl-3 py-3 text-right align-top">
                    <div
                      className={`font-semibold tabular-nums ${
                        (r.profit ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {r.profit != null ? fmtUsd(r.profit) : "—"}
                    </div>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5">
                      <TrendDelta current={r.profit} previous={prevFor(r.month, "profit")} />
                    </div>
                    <HeatBar value={r.profit} min={Math.min(0, stats.profit.min)} max={Math.max(0, stats.profit.max)} color="emerald" />
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr className="border-t-2 border-slate-200 bg-slate-50/60 text-sm">
              <td className="sticky left-0 z-10 bg-slate-50/95 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 backdrop-blur">
                Totals
              </td>
              <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{fmtUsd(totals.shopifyRevenue)}</td>
              <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{fmtNum(totals.shopifyOrders)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmtUsd(totals.metaSpend)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmtUsd(totals.googleSpend)}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{fmtUsd(totals.totalAdSpend)}</td>
              <td className="px-3 py-3 text-right">
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold tabular-nums text-blue-700 ring-1 ring-blue-100">
                  {fmtRoas(totals.trueRoas)}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{totals.aov != null ? fmtUsd(totals.aov) : "—"}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{totals.cpo != null ? fmtUsd(totals.cpo) : "—"}</td>
              <td className={`pr-5 pl-3 py-3 text-right font-bold tabular-nums ${totals.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                {fmtUsd(totals.profit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        <span>
          ▲▼ vs previous month · Bars show relative scale within the table window
        </span>
        <span className="text-slate-400">Profit uses your margin setting when available.</span>
      </div>
    </section>
  );
}

// ---------- page ----------
export default function MonthlyTablePreviewPage() {
  const [months, setMonths] = useState(6);
  const rows = useMemo(() => makeSampleRows(months).reverse(), [months]); // most-recent first to match prod

  return (
    <div className="min-h-screen bg-slate-50/60 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">
            Internal preview
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Monthly Performance table redesign — before / after
          </h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Sample data only. Approve the new look, then I’ll port it into the live{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">Monthly Rollup Table</code>{" "}
            section in <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">app/page.client.tsx</code>.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs font-medium text-slate-500">Sample window:</span>
            {[6, 12, 24].map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  months === m
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {m} months
              </button>
            ))}
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Current (live)
          </h2>
          <LiveStyleTable rows={rows} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Redesigned
          </h2>
          <RedesignedTable rows={rows} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            What’s changed
          </h2>
          <ul className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Light theme so it visually matches the rest of the dashboard
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Replaced full-cell heatmap wash with a thin proportional bar under each value
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Inline ▲▼ % vs previous month for revenue, orders, spend, profit
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              ROAS shown as a colored badge (≥3x emerald, ≥2x blue, otherwise amber)
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Profit colored emerald when positive, rose when negative
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Tabular numerals everywhere so columns align cleanly
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Sticky Month column with a subtle backdrop-blur (no harsh shadow line)
            </li>
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              Footer Totals row with weighted ROAS / AOV / CPO across the window
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
