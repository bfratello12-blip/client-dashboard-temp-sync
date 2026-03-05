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
  variant_title?: string;
  sku?: string;
  image_url?: string;
  admin_product_url?: string;
  admin_variant_url?: string;
  units: number;
  revenue: number;
  known_cogs: number;
  covered_revenue: number;
  uncovered_revenue: number;
  est_cogs: number;
  profit: number;
  profit_per_unit?: number;
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [limit, setLimit] = useState(100);
  const [showLossesOnly, setShowLossesOnly] = useState(false);

  const filteredRows = useMemo(() => {
    return showLossesOnly ? rows.filter((r) => (r.profit ?? 0) < 0) : rows;
  }, [rows, showLossesOnly]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const aVal: any = (a as any)[sortKey] ?? 0;
      const bVal: any = (b as any)[sortKey] ?? 0;
      if (sortDirection === "asc") return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [filteredRows, sortKey, sortDirection]);

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
    setPage(1);
  }, [rangeValue, sortKey, sortDirection, pageSize, limit, showLossesOnly]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          start: rangeValue.startISO,
          end: rangeValue.endISO,
          limit: String(limit),
        });
        const res = await authenticatedFetch(`/api/product-performance?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        if (!cancelled) {
          const nextRows = (json?.rows || []).map((row: ProductPerfRow) => {
            const units = Number(row?.units || 0);
            const profit = Number(row?.profit || 0);
            return {
              ...row,
              profit_per_unit: units > 0 ? profit / units : 0,
            } as ProductPerfRow;
          });
          setRows(nextRows as ProductPerfRow[]);
        }
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
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Top</span>
              <select
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[50, 100, 200, 500].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                checked={showLossesOnly}
                onChange={(e) => setShowLossesOnly(e.target.checked)}
              />
              Show Losing Products
            </label>
            <DateRangePicker
              value={rangeValue}
              onChange={setRangeValue}
              availableMinISO={undefined}
              availableMaxISO={undefined}
            />
          </div>
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
                    <button className="inline-flex items-center" onClick={() => handleSort("profit_per_unit")}>Profit / Unit{sortIndicator("profit_per_unit")}</button>
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
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No products found for this range.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr
                      key={`${row.variant_id}-${row.inventory_item_id}`}
                      className={Number(row.profit || 0) < 0 ? "bg-rose-50" : ""}
                    >
                      <td className="px-3 py-2">
                        <a
                          href={row.admin_variant_url || row.admin_product_url || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center hover:opacity-80"
                        >
                          {row.image_url ? (
                            <img
                              src={row.image_url}
                              alt={row.product_title || "Product"}
                              className="h-10 w-10 rounded-md object-cover mr-3"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md bg-slate-100 mr-3" />
                          )}
                          <div>
                            <div className="font-medium text-slate-900">{row.product_title || "Untitled product"}</div>
                            <div className="text-xs text-slate-500">
                              {[row.variant_title, row.sku].filter(Boolean).join(" • ")}
                            </div>
                            <div className="text-xs text-slate-500">{row.variant_id}</div>
                          </div>
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{Number(row.units || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(Number(row.revenue || 0))}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(Number(row.est_cogs || 0))}</td>
                      <td
                        className={[
                          "px-3 py-2 text-right font-semibold",
                          Number(row.profit || 0) > 0
                            ? "text-green-700"
                            : Number(row.profit || 0) < 0
                            ? "text-rose-700"
                            : "text-slate-700",
                        ].join(" ")}
                      >
                        {formatCurrency(Number(row.profit || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {formatCurrency(Number(row.profit_per_unit || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatPct1(Number(row.cogs_coverage_pct || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && !error && filteredRows.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-50"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-50"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
                <span>Page {page} of {totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Rows</span>
                <select
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {[25, 50, 100].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </DashboardLayout>
  );
}
