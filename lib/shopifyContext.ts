type QueryLike = {
  get: (key: string) => string | null;
};

export type AppClientContext = {
  shop: string;
  shop_domain: string;
  host: string;
  embedded: string;
  client_id: string;
};

const APP_CONTEXT_KEY = "sa_app_context";
const APP_CONTEXT_CAPTURED_KEY = "sa_app_context_captured";
const APP_CONTEXT_UPDATED_EVENT = "sa-app-context-updated";
const SHOP_DOMAIN_STORAGE_KEY = "shop_domain";

function normalize(v: string) {
  return String(v || "").trim();
}

function normalizeShopDomain(v: string) {
  const s = normalize(v).toLowerCase();
  if (!s) return "";
  if (s.endsWith(".myshopify.com")) return s;
  return s;
}

function emptyContext(): AppClientContext {
  return {
    shop: "",
    shop_domain: "",
    host: "",
    embedded: "",
    client_id: "",
  };
}

export function getPersistedAppContextClient(): AppClientContext {
  if (typeof window === "undefined") return emptyContext();
  try {
    const raw = window.sessionStorage.getItem(APP_CONTEXT_KEY);
    const directShopDomain = normalizeShopDomain(window.sessionStorage.getItem(SHOP_DOMAIN_STORAGE_KEY) || "");
    if (!raw) {
      if (!directShopDomain) return emptyContext();
      return {
        ...emptyContext(),
        shop_domain: directShopDomain,
        shop: directShopDomain,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AppClientContext>;
    const parsedShopDomain = normalizeShopDomain(parsed?.shop_domain || "");
    const mergedShopDomain = parsedShopDomain || directShopDomain;
    return {
      shop: normalize(parsed?.shop || ""),
      shop_domain: mergedShopDomain,
      host: normalize(parsed?.host || ""),
      embedded: normalize(parsed?.embedded || ""),
      client_id: normalize(parsed?.client_id || ""),
    };
  } catch {
    return emptyContext();
  }
}

export function persistAppContextClient(patch: Partial<AppClientContext>) {
  if (typeof window === "undefined") return;
  const current = getPersistedAppContextClient();

  const keepOrReplace = (nextValue: string | undefined, currentValue: string, normalizer = normalize) => {
    if (nextValue == null) return currentValue;
    const normalized = normalizer(nextValue);
    return normalized || currentValue;
  };

  const next: AppClientContext = {
    shop: keepOrReplace(patch.shop, current.shop),
    shop_domain: keepOrReplace(patch.shop_domain, current.shop_domain, normalizeShopDomain),
    host: keepOrReplace(patch.host, current.host),
    embedded: keepOrReplace(patch.embedded, current.embedded),
    client_id: keepOrReplace(patch.client_id, current.client_id),
  };
  try {
    window.sessionStorage.setItem(APP_CONTEXT_KEY, JSON.stringify(next));
    if (next.shop_domain) {
      window.sessionStorage.setItem(SHOP_DOMAIN_STORAGE_KEY, next.shop_domain);
    }
    window.sessionStorage.setItem(APP_CONTEXT_CAPTURED_KEY, "1");
    window.dispatchEvent(new CustomEvent(APP_CONTEXT_UPDATED_EVENT, { detail: next }));
  } catch {}
}

export function persistAppContextFromSearchParamsClient(params: QueryLike) {
  const shop = normalize(params.get("shop") || "").toLowerCase();
  const shopDomain = normalizeShopDomain((params.get("shop_domain") || "").toLowerCase());
  const host = normalize(params.get("host") || "");
  const embedded = normalize(params.get("embedded") || "");
  const clientId = normalize(params.get("client_id") || "");
  const patch: Partial<AppClientContext> = {};
  if (shop) patch.shop = shop;
  if (shopDomain || shop) patch.shop_domain = shopDomain || shop;
  if (host) patch.host = host;
  if (embedded) patch.embedded = embedded;
  if (clientId) patch.client_id = clientId;
  persistAppContextClient(patch);
}

export function captureAppContextFromSearchParamsClient(params: QueryLike) {
  if (typeof window === "undefined") return;
  const alreadyCaptured = window.sessionStorage.getItem(APP_CONTEXT_CAPTURED_KEY) === "1";
  if (alreadyCaptured) return;
  persistAppContextFromSearchParamsClient(params);
}

export function getStoredContextValueClient(key: keyof AppClientContext): string {
  const persisted = getPersistedAppContextClient();
  if (key === "shop_domain") {
    const persistedShopDomain = normalize((persisted as any)?.shop_domain || "");
    if (persistedShopDomain) return normalizeShopDomain(persistedShopDomain);
    const persistedShop = normalize((persisted as any)?.shop || "");
    if (persistedShop) return normalizeShopDomain(persistedShop);
  }
  return normalize((persisted as any)?.[key] || "");
}

export function getRuntimeContextValueClient(key: keyof AppClientContext): string {
  if (typeof window === "undefined") return getStoredContextValueClient(key);

  const params = new URLSearchParams(window.location.search);
  const direct = normalize(params.get(key) || "");
  if (direct) {
    if (key === "shop_domain") {
      const normalized = normalizeShopDomain(direct);
      persistAppContextClient({ shop_domain: normalized, shop: normalized });
      return normalized;
    }
    persistAppContextClient({ [key]: direct } as Partial<AppClientContext>);
    return direct;
  }

  if (key === "shop_domain") {
    const shopDirect = normalize(params.get("shop") || "");
    if (shopDirect) {
      const normalized = normalizeShopDomain(shopDirect);
      persistAppContextClient({ shop: shopDirect, shop_domain: normalized });
      return normalized;
    }
  }

  return getStoredContextValueClient(key);
}

export function resolveShopDomain(params?: QueryLike): string | null {
  const fromUrl = (() => {
    if (params) {
      const direct = normalize(params.get("shop_domain") || "");
      if (direct) return normalizeShopDomain(direct);
      const shop = normalize(params.get("shop") || "");
      if (shop) return normalizeShopDomain(shop);
      return "";
    }
    if (typeof window === "undefined") return "";
    const search = new URLSearchParams(window.location.search);
    const direct = normalize(search.get("shop_domain") || "");
    if (direct) return normalizeShopDomain(direct);
    const shop = normalize(search.get("shop") || "");
    if (shop) return normalizeShopDomain(shop);
    return "";
  })();

  if (fromUrl) {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(SHOP_DOMAIN_STORAGE_KEY, fromUrl);
      } catch {}
    }
    persistAppContextClient({ shop_domain: fromUrl, shop: fromUrl });
    return fromUrl;
  }

  if (typeof window !== "undefined") {
    const stored = normalizeShopDomain(window.sessionStorage.getItem(SHOP_DOMAIN_STORAGE_KEY) || "");
    if (stored) return stored;
  }

  const storedContextDomain = getStoredContextValueClient("shop_domain");
  return storedContextDomain || null;
}

export function onAppContextUpdatedClient(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => listener();
  window.addEventListener(APP_CONTEXT_UPDATED_EVENT, wrapped as EventListener);
  return () => {
    window.removeEventListener(APP_CONTEXT_UPDATED_EVENT, wrapped as EventListener);
  };
}

export function getContextValueClient(params: QueryLike, key: keyof AppClientContext): string {
  const stored = getStoredContextValueClient(key);
  if (stored) return stored;

  const direct = normalize(params.get(key) || "");
  if (direct) {
    if (key === "shop_domain") {
      const normalized = normalizeShopDomain(direct);
      persistAppContextClient({ shop_domain: normalized, shop: normalized });
      return normalized;
    }
    persistAppContextClient({ [key]: direct } as Partial<AppClientContext>);
    return direct;
  }

  if (key === "shop_domain") {
    const directShop = normalize(params.get("shop") || "");
    if (directShop) {
      const normalized = normalizeShopDomain(directShop);
      persistAppContextClient({ shop: directShop, shop_domain: normalized });
      return normalized;
    }
  }
  return "";
}

export function hasShopifyContextClient(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const shop = (params.get("shop") || "").trim();
  const host = (params.get("host") || "").trim();
  const embedded = (params.get("embedded") || "").trim();

  const hasQuerySignals = Boolean(shop || host || embedded === "1");
  if (hasQuerySignals) {
    try {
      window.sessionStorage.setItem("sa_embedded_shopify", "1");
    } catch {}
    return true;
  }

  const hasShopCookie = document.cookie
    .split(";")
    .map((v) => v.trim())
    .some((v) => v.startsWith("sa_shop="));
  if (hasShopCookie) return true;

  try {
    if (window.sessionStorage.getItem("sa_embedded_shopify") === "1") {
      return true;
    }
  } catch {}

  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
