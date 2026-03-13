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
