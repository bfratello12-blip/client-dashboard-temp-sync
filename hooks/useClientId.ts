"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function useClientId() {
  const params = useSearchParams();

  const urlClientId = (params.get("client_id") || "").trim();
  const shop = (params.get("shop") || "").trim().toLowerCase();
  const [clientId, setClientId] = useState<string>(urlClientId);

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
        const res = await fetch(`/api/client-by-shop?shop=${encodeURIComponent(shop)}`, {
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
