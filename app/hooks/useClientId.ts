"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export function useClientId() {
  const params = useSearchParams();
  const clientIdFromUrl = (params.get("client_id") || "").trim();
  const shopFromUrl = (params.get("shop") || "").trim().toLowerCase();

  const [resolvedClientId, setResolvedClientId] = useState<string>(clientIdFromUrl);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (clientIdFromUrl) {
        if (!cancelled) setResolvedClientId(clientIdFromUrl);
        return;
      }

      if (!shopFromUrl) {
        if (!cancelled) setResolvedClientId("");
        return;
      }

      try {
        const res = await fetch(`/api/client-by-shop?shop=${encodeURIComponent(shopFromUrl)}`, {
          method: "GET",
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        const fallbackClientId = typeof json?.client_id === "string" ? json.client_id.trim() : "";

        if (!cancelled) {
          setResolvedClientId(res.ok && json?.ok ? fallbackClientId : "");
        }
      } catch {
        if (!cancelled) setResolvedClientId("");
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [clientIdFromUrl, shopFromUrl]);

  return resolvedClientId;
}
