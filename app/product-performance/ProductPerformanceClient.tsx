"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import DashboardLayout from "@/components/DashboardLayout";
import DateRangePicker from "@/app/components/DateRangePicker";
import { authenticatedFetch } from "@/lib/shopify/authenticatedFetch";
import { getStoredContextValueClient } from "@/lib/shopifyContext";

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

type SummaryInfo = {
  productsAnalyzed: number;
  revenueCovered: number;
  profitCovered: number;
  avgMarginPct: number;
  revenueCoveragePct: number;
  profitCoveragePct: number;
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

function getValueColor(value: number) {
  if (value > 0) return "text-green-600";
  if (value < 0) return "text-red-600";
  return "text-gray-600";
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

export default function ProductPerformanceClient() {
  const shopDomain = (
    getStoredContextValueClient("shop") ||
    getStoredContextValueClient("shop_domain") ||
    ""
  )
    .trim()
    .toLowerCase();
  const contextClientId = getStoredContextValueClient("client_id").trim();
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
        // no-op; fetchRows will surface a user-facing message only if still unresolved.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopDomain, resolvedShopDomain, contextClientId]);

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
  const [summary, setSummary] = useState<SummaryInfo>({
    productsAnalyzed: 0,
    revenueCovered: 0,
    profitCovered: 0,
    avgMarginPct: 0,
    revenueCoveragePct: 0,
    profitCoveragePct: 0,
  });
  const [sortKey, setSortKey] = useState<keyof ProductPerfRow>("profit");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);


  const handleSort = (key: keyof ProductPerfRow) => {
    const nextDir = key === sortKey ? (sortDirection === "desc" ? "asc" : "desc") : "desc";
    console.debug("[product-performance] sort", { sortKey: key, sortDir: nextDir });
    setPage(1);
    setSortKey(key);
    setSortDirection(nextDir);
  };

  const sortIndicator = (key: keyof ProductPerfRow) => {
    if (key !== sortKey) return null;
    return <span className="ml-1 text-xs text-slate-400">{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  useEffect(() => {
    setPage(1);
  }, [rangeValue, sortKey, sortDirection, pageSize, searchTerm, activeFilter]);

  const totalPages = pagination.totalPages || 1;
  const displayedRows = rows;


  const fetchRows = React.useCallback(
    async (range: RangeValue, isCancelled?: () => boolean) => {
      setLoading(true);
      setError("");
      try {
        const effectiveShopDomain = (resolvedShopDomain || shopDomain || "").trim().toLowerCase();
        if (!effectiveShopDomain) {
          console.error("[product-performance] Missing shop domain in URL/session context. Skipping API request.");
          if (!isCancelled?.()) {
            setError("Missing shop domain in URL or session context");
          }
          return;
        }

        const params = new URLSearchParams({
          shop_domain: effectiveShopDomain,
          start: range.startISO,
          end: range.endISO,
          limit: String(pageSize),
          page: String(page),
        });
        params.set("sortKey", String(sortKey));
        params.set("sortDir", String(sortDirection));
        const search = searchTerm.trim();
        if (search) params.set("search", search);
        const filterMap: Record<string, string> = {
          all: "all",
          rising: "rising",
          declining: "declining",
          "low-inventory": "low_inventory",
          "high-margin": "high_margin",
          losing: "losing_products",
        };
        params.set("filter", filterMap[activeFilter] || "all");
        const url = `/api/data/product-performance?${params.toString()}`;
        console.debug("[product-performance] fetch", { url });
        const res = await authenticatedFetch(url);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        if (!isCancelled?.()) {
          console.debug("[product-performance] response", {
            sample: (json?.rows || []).slice(0, 3).map((row: ProductPerfRow) => ({
              variant_id: row?.variant_id,
              profit: row?.profit,
            })),
          });
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
          setSummary({
            productsAnalyzed: Number(json?.summary?.productsAnalyzed || 0),
            revenueCovered: Number(json?.summary?.revenueCovered || 0),
            profitCovered: Number(json?.summary?.profitCovered || 0),
            avgMarginPct: Number(json?.summary?.avgMarginPct || 0),
            revenueCoveragePct: Number(json?.summary?.revenueCoveragePct || 0),
            profitCoveragePct: Number(json?.summary?.profitCoveragePct || 0),
          });
        }
      } catch (e: any) {
        if (!isCancelled?.()) setError(e?.message || "Failed to load product performance");
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [shopDomain, resolvedShopDomain, page, pageSize, searchTerm, activeFilter, sortKey, sortDirection]
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
                {summary.productsAnalyzed.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Revenue covered
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {formatCurrency(summary.revenueCovered)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Profit covered
              </div>
              <div
                className={[
                  "mt-1 text-lg font-semibold",
                  summary.profitCovered >= 0 ? "text-emerald-700" : "text-rose-700",
                ].join(" ")}
              >
                {formatCurrency(summary.profitCovered)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Avg margin
              </div>
              <div
                className={[
                  "mt-1 text-lg font-semibold",
                  summary.avgMarginPct >= 0 ? "text-slate-900" : "text-rose-700",
                ].join(" ")}
              >
                {formatPct1(summary.avgMarginPct)}
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
                  return `Showing ${rows.length} of ${pagination.total} matching products`;
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
                ) : rows.length === 0 ? (
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
                      <td className="px-3 py-2 text-center font-semibold">
                        <span className={getValueColor(Number(row.profit || 0))}>
                          {formatCurrency(Number(row.profit || 0))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={getValueColor(Number(row.profit_per_unit || 0))}>
                          {formatCurrency(Number(row.profit_per_unit || 0))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={getValueColor(Number(row.profit_margin_pct || 0))}>
                          {formatPct1(Number(row.profit_margin_pct || 0))}
                        </span>
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
          {!loading && !error && rows.length > 0 ? (
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
