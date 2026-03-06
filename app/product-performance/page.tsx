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
  profit_margin_pct?: number;
  revenue_share_pct?: number;
  units_per_day?: number;
  prev_revenue?: number;
  trend_pct?: number;
  on_hand_units?: number | null;
  days_of_inventory?: number | null;
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

type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatPct1(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function formatPct0(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

function trendLabel(v: number) {
  if (!Number.isFinite(v)) return { icon: "•", tone: "text-slate-600", value: "0%" };
  if (Math.abs(v) < 0.005) return { icon: "•", tone: "text-slate-600", value: "0%" };
  if (v > 0) return { icon: "▲", tone: "text-green-700", value: `+${formatPct1(v)}` };
  return { icon: "▼", tone: "text-rose-700", value: formatPct1(v) };
}

function last30DaysRange() {
  const endISO = format(new Date(), "yyyy-MM-dd");
  const startISO = format(subDays(new Date(), 29), "yyyy-MM-dd");
  return { startISO, endISO };
}

function HeaderTooltip({ text, align = "center" }: { text: string; align?: "center" | "right" }) {
  const positionClass =
    align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";
  return (
    <span className="relative inline-flex items-center group">
      <span
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        tabIndex={0}
        aria-label={text}
      >
        i
      </span>
      <span
        className={`pointer-events-none absolute top-full z-50 mt-2 w-56 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${positionClass}`}
      >
        {text}
      </span>
    </span>
  );
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
  const [syncingInventory, setSyncingInventory] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<
    "all" | "rising" | "declining" | "low-inventory" | "high-margin" | "losing"
  >("all");
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
  });
  const [totals, setTotals] = useState({ totalRevenue: 0, totalProfit: 0, totalUnits: 0 });
  const [sortKey, setSortKey] = useState<keyof ProductPerfRow>("profit");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let next = rows;
    if (term) {
      next = next.filter((r) => {
        const hay = [r.product_title, r.variant_title, r.sku, r.variant_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      });
    }

    switch (activeFilter) {
      case "rising":
        return next.filter((r) => Number(r?.trend_pct || 0) > 0);
      case "declining":
        return next.filter((r) => Number(r?.trend_pct || 0) < 0);
      case "low-inventory":
        return next.filter(
          (r) => r.days_of_inventory != null && Number(r.days_of_inventory) <= 7
        );
      case "high-margin":
        return next.filter((r) => Number(r?.profit_margin_pct || 0) >= 0.4);
      case "losing":
        return next.filter((r) => Number(r?.profit || 0) < 0);
      default:
        return next;
    }
  }, [rows, searchTerm, activeFilter]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const aRaw: any = (a as any)[sortKey];
      const bRaw: any = (b as any)[sortKey];

      const toNum = (v: any) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
      let aVal = toNum(aRaw);
      let bVal = toNum(bRaw);

      if (sortKey === "days_of_inventory") {
        const normalize = (row: ProductPerfRow) => {
          if (row.days_of_inventory != null) return Number(row.days_of_inventory);
          if (row.on_hand_units != null) {
            return sortDirection === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
          }
          return sortDirection === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        };
        aVal = normalize(a);
        bVal = normalize(b);
      }

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
  }, [rangeValue, sortKey, sortDirection, pageSize, searchTerm, activeFilter]);

  const totalPages = pagination.totalPages || 1;
  const displayedRows = sortedRows;

  const summary = useMemo(() => {
    const totalRevenue = totals.totalRevenue;
    const totalProfit = totals.totalProfit;
    const filteredRevenue = filteredRows.reduce(
      (sum, r) => sum + Number(r?.revenue || 0),
      0
    );
    const filteredProfit = filteredRows.reduce(
      (sum, r) => sum + Number(r?.profit || 0),
      0
    );
    const avgMargin = filteredRevenue > 0 ? filteredProfit / filteredRevenue : 0;
    const revenueCoveragePct = totalRevenue > 0 ? filteredRevenue / totalRevenue : 0;
    const profitCoveragePct = totalProfit !== 0 ? filteredProfit / totalProfit : 0;
    return {
      products: filteredRows.length,
      filteredRevenue,
      filteredProfit,
      avgMargin,
      revenueCoveragePct,
      profitCoveragePct,
    };
  }, [rows, filteredRows]);

  const fetchRows = React.useCallback(
    async (range: RangeValue, isCancelled?: () => boolean) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          start: range.startISO,
          end: range.endISO,
          limit: String(pageSize),
          page: String(page),
        });
        const res = await authenticatedFetch(`/api/product-performance?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        if (!isCancelled?.()) {
          const nextRows = (json?.rows || []).map((row: ProductPerfRow) => {
            const units = Number(row?.units || 0);
            const profit = Number(row?.profit || 0);
            return {
              ...row,
              profit_per_unit: units > 0 ? profit / units : 0,
            } as ProductPerfRow;
          });
          setRows(nextRows as ProductPerfRow[]);
          setPagination({
            page: Number(json?.pagination?.page || page),
            limit: Number(json?.pagination?.limit || pageSize),
            total: Number(json?.pagination?.total || 0),
            totalPages: Number(json?.pagination?.totalPages || 1),
          });
          setTotals({
            totalRevenue: Number(json?.meta?.total_revenue || 0),
            totalProfit: Number(json?.meta?.total_profit || 0),
            totalUnits: Number(json?.meta?.total_units || 0),
          });
        }
      } catch (e: any) {
        if (!isCancelled?.()) setError(e?.message || "Failed to load product performance");
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [page, pageSize]
  );

  useEffect(() => {
    let cancelled = false;
    fetchRows(rangeValue, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchRows, rangeValue]);

  const handleInventorySync = async () => {
    if (syncingInventory) return;
    setSyncingInventory(true);
    setSyncMessage("");
    try {
      const res = await authenticatedFetch("/api/inventory/sync", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Sync failed (${res.status})`);
      }
      setSyncMessage(`Inventory synced (${Number(json?.updated || 0).toLocaleString()})`);
      await fetchRows(rangeValue);
    } catch (e: any) {
      setSyncMessage(e?.message || "Inventory sync failed");
    } finally {
      setSyncingInventory(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 md:p-8 min-w-0">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Product Performance</h1>
            <p className="mt-1 text-slate-600">Products with sales in the selected date range</p>
            <p className="mt-1 text-sm text-slate-500">Sorted by profit by default.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 placeholder:text-slate-400"
              placeholder="Search products, SKU, or variant ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={syncingInventory}
              onClick={handleInventorySync}
            >
              {syncingInventory ? "Syncing…" : "Sync Inventory"}
            </button>
            {syncMessage ? <span className="text-xs text-slate-500">{syncMessage}</span> : null}
            <DateRangePicker
              value={rangeValue}
              onChange={setRangeValue}
              availableMinISO={undefined}
              availableMaxISO={undefined}
            />
          </div>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([
              { key: "all", label: "All Products" },
              { key: "rising", label: "Rising" },
              { key: "declining", label: "Declining" },
              { key: "low-inventory", label: "Low Inventory" },
              { key: "high-margin", label: "High Margin" },
              { key: "losing", label: "Losing Products" },
            ] as const).map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setActiveFilter(chip.key)}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  activeFilter === chip.key
                    ? "border-slate-500 bg-slate-100 text-slate-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                ].join(" ")}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Products analyzed
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {summary.products.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Revenue covered
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {formatCurrency(summary.filteredRevenue)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Profit covered
              </div>
              <div
                className={[
                  "mt-1 text-lg font-semibold",
                  summary.filteredProfit >= 0 ? "text-emerald-700" : "text-rose-700",
                ].join(" ")}
              >
                {formatCurrency(summary.filteredProfit)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Avg margin
              </div>
              <div
                className={[
                  "mt-1 text-lg font-semibold",
                  summary.avgMargin >= 0 ? "text-slate-900" : "text-rose-700",
                ].join(" ")}
              >
                {formatPct1(summary.avgMargin)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                % of Revenue
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {formatPct1(summary.revenueCoveragePct)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                % of Profit
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {formatPct1(summary.profitCoveragePct)}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="mb-2 text-xs text-slate-500">
              {(() => {
                const filterActive = searchTerm.trim().length > 0 || activeFilter !== "all";
                if (filterActive) {
                  return `Showing ${filteredRows.length} of ${rows.length} loaded products (${pagination.total} total with sales)`;
                }
                return `Showing ${rows.length} of ${pagination.total} products with sales`;
              })()}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2">Product</th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("units")}>
                        Units{sortIndicator("units")}
                      </button>
                      <HeaderTooltip text="Units sold in the selected date range." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("units_per_day")}>
                        Units/Day{sortIndicator("units_per_day")}
                      </button>
                      <HeaderTooltip text="Average units sold per day in the selected date range." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("revenue")}>
                        Revenue{sortIndicator("revenue")}
                      </button>
                      <HeaderTooltip text="Total product revenue in the selected date range." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("revenue_share_pct")}>
                        Rev Share{sortIndicator("revenue_share_pct")}
                      </button>
                      <HeaderTooltip text="This product’s share of total store revenue for the selected date range." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("est_cogs")}>
                        Est. COGS{sortIndicator("est_cogs")}
                      </button>
                      <HeaderTooltip text="Estimated cost of goods sold based on known unit costs and fallback margin settings." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("profit")}>
                        Profit{sortIndicator("profit")}
                      </button>
                      <HeaderTooltip text="Revenue minus estimated cost of goods sold." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("profit_per_unit")}>
                        Profit / Unit{sortIndicator("profit_per_unit")}
                      </button>
                      <HeaderTooltip text="Average profit earned per unit sold." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("profit_margin_pct")}>
                        Margin{sortIndicator("profit_margin_pct")}
                      </button>
                      <HeaderTooltip text="Profit as a percentage of revenue." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("trend_pct")}>
                        Trend{sortIndicator("trend_pct")}
                      </button>
                      <HeaderTooltip text="Revenue change compared with the previous matching date range." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("days_of_inventory")}>
                        Inventory{sortIndicator("days_of_inventory")}
                      </button>
                      <HeaderTooltip text="Estimated days of inventory remaining, with current units on hand shown in parentheses." />
                    </span>
                  </th>
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-center">
                    <span className="inline-flex items-center">
                      <button className="inline-flex items-center" onClick={() => handleSort("cogs_coverage_pct")}>
                        COGS Coverage{sortIndicator("cogs_coverage_pct")}
                      </button>
                      <HeaderTooltip
                        text="Percent of this product’s revenue covered by known cost data instead of fallback estimates."
                        align="right"
                      />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                      Loading product performance…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-rose-600">
                      {error}
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                      No products found for this range.
                    </td>
                  </tr>
                ) : (
                  displayedRows.map((row) => (
                    <tr
                      key={`${row.variant_id}-${row.inventory_item_id}`}
                      className={[
                        "hover:bg-slate-50 transition-colors border-b border-slate-200 last:border-b-0",
                        Number(row.profit || 0) < 0 ? "bg-rose-50" : "",
                      ].join(" ")}
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
                      <td className="px-3 py-2 text-center text-slate-700">{Number(row.units || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{Number(row.units_per_day || 0).toFixed(1)}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{formatCurrency(Number(row.revenue || 0))}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{formatPct1(Number(row.revenue_share_pct || 0))}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{formatCurrency(Number(row.est_cogs || 0))}</td>
                      <td
                        className="px-3 py-2 text-center font-semibold text-emerald-700"
                      >
                        {formatCurrency(Number(row.profit || 0))}
                      </td>
                      <td className="px-3 py-2 text-center text-slate-700">
                        {formatCurrency(Number(row.profit_per_unit || 0))}
                      </td>
                      <td className="px-3 py-2 text-center text-slate-700">
                        {formatPct1(Number(row.profit_margin_pct || 0))}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(() => {
                          const t = trendLabel(Number(row.trend_pct || 0));
                          return (
                            <span className={t.tone}>
                              {t.icon} {t.value}
                            </span>
                          );
                        })()}
                      </td>
                      <td
                        className={[
                          "px-3 py-2 text-center",
                          row.days_of_inventory == null
                            ? "text-slate-500"
                            : row.days_of_inventory <= 7
                            ? "text-rose-700"
                            : row.days_of_inventory <= 21
                            ? "text-amber-700"
                            : "text-slate-700",
                        ].join(" ")}
                      >
                        {(() => {
                          const days = row.days_of_inventory;
                          const onHand = row.on_hand_units;
                          if (days != null && onHand != null) {
                            const daysRounded = days < 10 ? days.toFixed(1) : days.toFixed(0);
                            return `${daysRounded}d (${Number(onHand).toLocaleString()})`;
                          }
                          if (days == null && onHand != null) {
                            return `(${Number(onHand).toLocaleString()})`;
                          }
                          return "—";
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center text-slate-700">{formatPct1(Number(row.cogs_coverage_pct || 0))}</td>
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
