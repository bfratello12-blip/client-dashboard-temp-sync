"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type ScatterCorrelationPoint = {
  date: string;
  adSpend: number;
  revenue: number;
};

export default function ScatterCorrelationChart({
  data,
}: {
  data: ScatterCorrelationPoint[];
}) {
  const linePoints = useMemo(() => {
    const points = (data || []).filter(
      (p) => Number.isFinite(Number(p?.adSpend)) && Number.isFinite(Number(p?.revenue))
    );
    const n = points.length;
    if (n < 2) return [] as Array<{ adSpend: number; revenue: number }>;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    for (const p of points) {
      const x = Number(p.adSpend || 0);
      const y = Number(p.revenue || 0);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12 || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
      return [] as Array<{ adSpend: number; revenue: number }>;
    }

    const m = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY - m * sumX) / n;

    return [
      { adSpend: minX, revenue: m * minX + b },
      { adSpend: maxX, revenue: m * maxX + b },
    ];
  }, [data]);

  return (
    <div className="h-[320px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, left: 16, bottom: 12 }}>
          <CartesianGrid stroke="#94a3b8" strokeDasharray="4 6" strokeOpacity={0.2} />

          <XAxis
            type="number"
            dataKey="adSpend"
            name="Ad Spend"
            label={{ value: "Ad Spend ($)", position: "insideBottom", offset: -6, fill: "#64748b", fontSize: 12 }}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0", strokeOpacity: 0.35 }}
          />

          <YAxis
            type="number"
            dataKey="revenue"
            name="Revenue"
            label={{ value: "Revenue ($)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 12 }}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0", strokeOpacity: 0.35 }}
          />

          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeDasharray: "4 6", strokeOpacity: 0.35 }}
            contentStyle={{
              backgroundColor: "rgba(255, 255, 255, 0.96)",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
            }}
            formatter={(value: any, name: any) => {
              const n = Number(value || 0);
              return [
                n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
                name,
              ];
            }}
            labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as ScatterCorrelationPoint | undefined;
              return row?.date ? `Date: ${row.date}` : "";
            }}
          />

          <Scatter data={data || []} fill="#3b82f6" />
          <Line
            data={linePoints}
            dataKey="revenue"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
