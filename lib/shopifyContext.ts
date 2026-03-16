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
    if (!raw) return emptyContext();
    const parsed = JSON.parse(raw) as Partial<AppClientContext>;
    return {
      shop: normalize(parsed?.shop || ""),
      shop_domain: normalizeShopDomain(parsed?.shop_domain || ""),
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
  const next: AppClientContext = {
    shop: normalize(patch.shop ?? current.shop),
    shop_domain: normalizeShopDomain(patch.shop_domain ?? current.shop_domain),
    host: normalize(patch.host ?? current.host),
    embedded: normalize(patch.embedded ?? current.embedded),
    client_id: normalize(patch.client_id ?? current.client_id),
  };
  try {
    window.sessionStorage.setItem(APP_CONTEXT_KEY, JSON.stringify(next));
  } catch {}
}

export function persistAppContextFromSearchParamsClient(params: QueryLike) {
  const shop = normalize(params.get("shop") || "").toLowerCase();
  const shopDomain = normalizeShopDomain((params.get("shop_domain") || "").toLowerCase());
  const host = normalize(params.get("host") || "");
  const embedded = normalize(params.get("embedded") || "");
  const clientId = normalize(params.get("client_id") || "");
  persistAppContextClient({
    shop,
    shop_domain: shopDomain || shop,
    host,
    embedded,
    client_id: clientId,
  });
}

export function getContextValueClient(params: QueryLike, key: keyof AppClientContext): string {
  const direct = normalize(params.get(key) || "");
  if (direct) return key === "shop_domain" ? normalizeShopDomain(direct) : direct;
  const persisted = getPersistedAppContextClient();
  return normalize((persisted as any)?.[key] || "");
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
