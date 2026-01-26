// lib/costEngine.ts

export type CostConfidence = "high" | "medium" | "low";
export type CostMode = "actual" | "hybrid" | "modeled";

export interface CostInputs {
  revenue: number;
  orders: number;

  productCogsKnown: number;          // sum of known product COGS
  revenueWithCogs: number;            // revenue covered by known COGS

  fallbackCogsRate: number;           // e.g. 0.42

  processingFeeRate: number;          // e.g. 0.029
  processingFeeFixed: number;         // e.g. 0.30

  packagingPerOrder: number;
  fulfillmentPerOrder: number;
  shippingPerOrder: number;

  thresholdActual?: number;           // default 0.95
  thresholdHybrid?: number;            // default 0.25
}

export interface CostResult {
  costMode: CostMode;
  costConfidence: CostConfidence;
  cogsCoveragePct: number;

  productCogsEffective: number;
  processingFees: number;
  packagingCost: number;
  fulfillmentCost: number;
  shippingCost: number;

  trueVariableCost: number;
  contributionProfit: number;
  contributionMargin: number;
}

export function calculateCosts(input: CostInputs): CostResult {
  const {
    revenue,
    orders,
    productCogsKnown,
    revenueWithCogs,
    fallbackCogsRate,
    processingFeeRate,
    processingFeeFixed,
    packagingPerOrder,
    fulfillmentPerOrder,
    shippingPerOrder,
    thresholdActual = 0.95,
    thresholdHybrid = 0.25,
  } = input;

  const cogsCoveragePct =
    revenue > 0 ? revenueWithCogs / revenue : 0;

  let costMode: CostMode;
  let costConfidence: CostConfidence;

  if (cogsCoveragePct >= thresholdActual) {
    costMode = "actual";
    costConfidence = "high";
  } else if (cogsCoveragePct >= thresholdHybrid) {
    costMode = "hybrid";
    costConfidence = "medium";
  } else {
    costMode = "modeled";
    costConfidence = "low";
  }

  let productCogsEffective = 0;

  if (costMode === "actual") {
    productCogsEffective = productCogsKnown;
  }

  if (costMode === "hybrid") {
    const missingRevenue = revenue - revenueWithCogs;
    productCogsEffective =
      productCogsKnown + missingRevenue * fallbackCogsRate;
  }

  if (costMode === "modeled") {
    productCogsEffective = revenue * fallbackCogsRate;
  }

  const processingFees =
    revenue * processingFeeRate + orders * processingFeeFixed;

  const packagingCost = orders * packagingPerOrder;
  const fulfillmentCost = orders * fulfillmentPerOrder;
  const shippingCost = orders * shippingPerOrder;

  const trueVariableCost =
    productCogsEffective +
    processingFees +
    packagingCost +
    fulfillmentCost +
    shippingCost;

  const contributionProfit = revenue - trueVariableCost;
  const contributionMargin =
    revenue > 0 ? contributionProfit / revenue : 0;

  return {
    costMode,
    costConfidence,
    cogsCoveragePct,

    productCogsEffective,
    processingFees,
    packagingCost,
    fulfillmentCost,
    shippingCost,

    trueVariableCost,
    contributionProfit,
    contributionMargin,
  };
}
