"use client";

import { useEffect, useState } from "react";
import {
  getPersistedAppContextClient,
  getStoredContextValueClient,
  onAppContextUpdatedClient,
  persistAppContextClient,
} from "@/lib/shopifyContext";

export default function useClientId() {
  const [clientId, setClientId] = useState<string | null>(() => {
    const storedClientId = getStoredContextValueClient("client_id");
    const persisted = getPersistedAppContextClient();
    const shop = String(persisted.shop_domain || persisted.shop || "").trim().toLowerCase();
    return storedClientId || (shop ? null : "");
  });

  useEffect(() => {
    const syncFromContext = () => {
      const storedClientId = getStoredContextValueClient("client_id");
      if (storedClientId) setClientId(storedClientId);
    };
    syncFromContext();
    return onAppContextUpdatedClient(syncFromContext);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const storedClientId = getStoredContextValueClient("client_id");
      if (storedClientId) {
        if (!cancelled) setClientId(storedClientId);
        return;
      }

      const persisted = getPersistedAppContextClient();
      const shop = String(persisted.shop_domain || persisted.shop || "").trim().toLowerCase();
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
          if (resolved) persistAppContextClient({ client_id: resolved });
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
  }, []);

  return clientId;
}

export { useClientId };
