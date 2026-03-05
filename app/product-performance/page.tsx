"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";

export const dynamic = "force-dynamic";

type ProductPerfRow = {
  variant_id: string;
  inventory_item_id: string;
  product_title?: string;
  product_image?: string;
  units: number;
  revenue: number;
  known_cogs: number;
  covered_revenue: number;
  uncovered_revenue: number;
  est_cogs: number;
  profit: number;
  cogs_coverage_pct: number;
};

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

function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatPct1(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function last30DaysRange() {
  const endISO = format(new Date(), "yyyy-MM-dd");
  const startISO = format(subDays(new Date(), 29), "yyyy-MM-dd");
  return { startISO, endISO };
}

export default function ProductPerformancePage() {
  const initialRange = useMemo(() => {
    const { startISO, endISO } = last30DaysRange();
    return { mode: "preset", preset: "last30days", startISO, endISO } as RangeValue;
  }, []);

  const [rangeValue, setRangeValue] = useState<RangeValue>(initialRange);
  const [rows, setRows] = useState<ProductPerfRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<keyof ProductPerfRow>("profit");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal: any = (a as any)[sortKey] ?? 0;
      const bVal: any = (b as any)[sortKey] ?? 0;
      if (sortDirection === "asc") return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [rows, sortKey, sortDirection]);

  const handleSort = (key: keyof ProductPerfRow) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const sortIndicator = (key: keyof ProductPerfRow) => {
    if (key !== sortKey) return null;
    return <span className="ml-1 text-xs text-slate-400">{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          start: rangeValue.startISO,
          end: rangeValue.endISO,
          limit: "100",
        });
        const res = await authenticatedFetch(`/api/product-performance?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        if (!cancelled) setRows((json?.rows || []) as ProductPerfRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load product performance");
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
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Product Performance</h1>
            <p className="mt-1 text-slate-600">Top 100 variants by estimated profit</p>
          </div>
          <DateRangePicker
            value={rangeValue}
            onChange={setRangeValue}
            availableMinISO={undefined}
            availableMaxISO={undefined}
          />
        </header>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">
                    <button className="inline-flex items-center" onClick={() => handleSort("units")}>Units{sortIndicator("units")}</button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button className="inline-flex items-center" onClick={() => handleSort("revenue")}>Revenue{sortIndicator("revenue")}</button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button className="inline-flex items-center" onClick={() => handleSort("est_cogs")}>Est. COGS{sortIndicator("est_cogs")}</button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button className="inline-flex items-center" onClick={() => handleSort("profit")}>Profit{sortIndicator("profit")}</button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button className="inline-flex items-center" onClick={() => handleSort("cogs_coverage_pct")}>COGS Coverage{sortIndicator("cogs_coverage_pct")}</button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Loading product performance…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-rose-600">
                      {error}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No products found for this range.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <tr key={`${row.variant_id}-${row.inventory_item_id}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center">
                          {row.product_image ? (
                            <img
                              src={row.product_image}
                              alt={row.product_title || "Product"}
                              className="h-10 w-10 rounded-md object-cover mr-3"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md bg-slate-100 mr-3" />
                          )}
                          <div>
                            <div className="font-medium text-slate-900">{row.product_title || "Untitled product"}</div>
                            <div className="text-xs text-slate-500">{row.variant_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{Number(row.units || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(Number(row.revenue || 0))}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(Number(row.est_cogs || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(Number(row.profit || 0))}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatPct1(Number(row.cogs_coverage_pct || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
