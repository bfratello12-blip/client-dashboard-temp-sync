"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getContextValueClient } from "@/lib/shopifyContext";

export default function useClientId() {
  const params = useSearchParams();

  const urlClientId = getContextValueClient(params as any, "client_id");
  const shop = (
    getContextValueClient(params as any, "shop") ||
    getContextValueClient(params as any, "shop_domain")
  )
    .trim()
    .toLowerCase();
  const [clientId, setClientId] = useState<string | null>(urlClientId || (shop ? null : ""));

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (urlClientId) {
        if (!cancelled) setClientId(urlClientId);
        return;
      }

      if (!shop) {
        if (!cancelled) setClientId("");
        return;
      }

      try {
        if (!cancelled) setClientId(null);

        const res = await fetch(`/api/client/resolve?shop=${encodeURIComponent(shop)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        const resolved = typeof data?.client_id === "string" ? data.client_id.trim() : "";
        if (!cancelled) {
          setClientId(res.ok ? resolved : "");
        }
      } catch {
        if (!cancelled) setClientId("");
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [urlClientId, shop]);

  return clientId;
}

export { useClientId };
