// lib/dailyMetrics.ts
import { getSupabaseAdmin } from "./supabaseAdmin";
import { dateRangeInclusiveUTC } from "./dates";

export type Source = "meta" | "google" | "shopify";

export type DailyMetricsRow = {
  client_id: string;
  source: Source;
  date: string; // YYYY-MM-DD
  spend: number;
  revenue: number;
  clicks: number;
  impressions: number;
  conversions: number;
  orders: number;
};
// --- Cost Engine helpers ---
// These helpers let the app calculate contribution profit/margin consistently,
// while gracefully handling missing/partial product COGS.
//
// Notes:
// - "Contribution" excludes fixed monthly overhead (Shopify plan, apps, agency fee, etc.).
// - You can run this at order/day/month level as long as revenue & orders align to the same window.

export type CostConfidence = "high" | "medium" | "low";
export type CostMode = "actual" | "hybrid" | "modeled";

export type CostSettings = {
  // Fallback product COGS rate used when product-level costs are partially missing or absent.
  // Example: 0.42 means 42% of revenue is assumed as product cost.
  fallbackCogsRate: number;

  // Payment processing fee model: % of revenue plus fixed fee per order.
  processingFeeRate?: number; // e.g. 0.029
  processingFeeFixed?: number; // e.g. 0.30

  // Per-order variable costs (set to 0 if already included in "COGS" or not applicable).
  packagingPerOrder?: number;
  fulfillmentPerOrder?: number;
  shippingPerOrder?: number;

  // Coverage thresholds that control auto-mode selection.
  // - If revenue coverage >= thresholdActual => actual (high confidence)
  // - Else if >= thresholdHybrid => hybrid (medium confidence)
  // - Else => modeled (low confidence)
  thresholdActual?: number; // default 0.95
  thresholdHybrid?: number; // default 0.25

  // Optional override (useful if a client says their COGS are "fully loaded" even if coverage is low)
  modeOverride?: CostMode;
};

export type CostInputs = {
  revenue: number;
  orders: number;

  // Sum of known product costs (only for items/SKUs where COGS is present).
  productCogsKnown: number;

  // Revenue associated with items/SKUs where COGS is present.
  revenueWithCogs: number;
};

export type CostKpis = {
  cost_mode: CostMode;
  cost_confidence: CostConfidence;
  cogs_coverage_pct: number;

  product_cogs_effective: number;
  processing_fees: number;
  packaging_cost: number;
  fulfillment_cost: number;
  shipping_cost: number;

  true_variable_cost: number;
  contribution_profit: number;
  contribution_margin: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function calculateCostKpis(inputs: CostInputs, settings: CostSettings): CostKpis {
  const revenue = Number(inputs.revenue || 0);
  const orders = Number(inputs.orders || 0);

  const productCogsKnown = Number(inputs.productCogsKnown || 0);
  const revenueWithCogs = Number(inputs.revenueWithCogs || 0);

  const fallbackCogsRate = clamp01(Number(settings.fallbackCogsRate || 0));

  const processingFeeRate = Number(settings.processingFeeRate ?? 0.029);
  const processingFeeFixed = Number(settings.processingFeeFixed ?? 0.30);

  const packagingPerOrder = Number(settings.packagingPerOrder ?? 0);
  const fulfillmentPerOrder = Number(settings.fulfillmentPerOrder ?? 0);
  const shippingPerOrder = Number(settings.shippingPerOrder ?? 0);

  const thresholdActual = clamp01(Number(settings.thresholdActual ?? 0.95));
  const thresholdHybrid = clamp01(Number(settings.thresholdHybrid ?? 0.25));

  const rawCoverage = revenue > 0 ? revenueWithCogs / revenue : 0;
  const cogs_coverage_pct = clamp01(rawCoverage);

  let cost_mode: CostMode;
  if (settings.modeOverride) {
    cost_mode = settings.modeOverride;
  } else if (cogs_coverage_pct >= thresholdActual) {
    cost_mode = "actual";
  } else if (cogs_coverage_pct >= thresholdHybrid) {
    cost_mode = "hybrid";
  } else {
    cost_mode = "modeled";
  }

  const cost_confidence: CostConfidence =
    cost_mode === "actual" ? "high" : cost_mode === "hybrid" ? "medium" : "low";

  // Product COGS effective:
  // - actual: use known product costs
  // - hybrid: fill missing revenue using fallback rate
  // - modeled: assume all revenue uses fallback rate
  let product_cogs_effective = 0;
  if (cost_mode === "actual") {
    product_cogs_effective = productCogsKnown;
  } else if (cost_mode === "hybrid") {
    const missingRevenue = Math.max(0, revenue - revenueWithCogs);
    product_cogs_effective = productCogsKnown + missingRevenue * fallbackCogsRate;
  } else {
    product_cogs_effective = revenue * fallbackCogsRate;
  }

  const processing_fees = revenue * processingFeeRate + orders * processingFeeFixed;
  const packaging_cost = orders * packagingPerOrder;
  const fulfillment_cost = orders * fulfillmentPerOrder;
  const shipping_cost = orders * shippingPerOrder;

  const true_variable_cost =
    product_cogs_effective + processing_fees + packaging_cost + fulfillment_cost + shipping_cost;

  const contribution_profit = revenue - true_variable_cost;
  const contribution_margin = revenue > 0 ? contribution_profit / revenue : 0;

  return {
    cost_mode,
    cost_confidence,
    cogs_coverage_pct,

    product_cogs_effective,
    processing_fees,
    packaging_cost,
    fulfillment_cost,
    shipping_cost,

    true_variable_cost,
    contribution_profit,
    contribution_margin,
  };
}

// Table PK: (date, client_id, source)
const ON_CONFLICT = "date,client_id,source";

function zeroRowBase(clientId: string, source: Source, day: string): DailyMetricsRow {
  return {
    client_id: clientId,
    source,
    date: day,
    spend: 0,
    revenue: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    orders: 0,
  };
}

export async function upsertDailyMetrics(rows: DailyMetricsRow[]): Promise<void> {
  if (!rows.length) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("daily_metrics").upsert(rows, { onConflict: ON_CONFLICT });
  if (error) throw new Error(`daily_metrics upsert failed: ${error.message}`);
}

export async function ensureDailyMetricsRows(params: {
  clientId: string;
  source: Source;
  startDay: string;
  endDay: string;
}): Promise<{ inserted: number }> {
  const { clientId, source, startDay, endDay } = params;
  const supabase = getSupabaseAdmin();

  const days = dateRangeInclusiveUTC(startDay, endDay);
  if (!days.length) return { inserted: 0 };

  const { data, error } = await supabase
    .from("daily_metrics")
    .select("date")
    .eq("client_id", clientId)
    .eq("source", source)
    .gte("date", startDay)
    .lte("date", endDay);

  if (error) throw new Error(`daily_metrics select failed: ${error.message}`);

  const existing = new Set((data ?? []).map((r: any) => r.date));
  const missing = days.filter((d) => !existing.has(d));
  if (!missing.length) return { inserted: 0 };

  const inserts = missing.map((d) => zeroRowBase(clientId, source, d));

  const ins = await supabase
    .from("daily_metrics")
    .upsert(inserts, { onConflict: ON_CONFLICT, ignoreDuplicates: true });

  if (ins.error) throw new Error(`daily_metrics gap-fill failed: ${ins.error.message}`);
  return { inserted: missing.length };
}




