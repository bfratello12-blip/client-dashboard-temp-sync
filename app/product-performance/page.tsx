import { Suspense } from "react";
import ProductPerformanceClient from "./ProductPerformanceClient";

export const dynamic = "force-dynamic";

export default function ProductPerformancePage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 md:p-8 text-sm text-slate-500">Loading product performance…</div>
      }
    >
      <ProductPerformanceClient />
    </Suspense>
  );
}
