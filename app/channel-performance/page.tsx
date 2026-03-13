import { Suspense } from "react";
import ChannelPerformanceClient from "./ChannelPerformanceClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading...</div>}>
      <ChannelPerformanceClient />
    </Suspense>
  );
}
