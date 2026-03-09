export function hasShopifyContextClient(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop") || "";
  const host = params.get("host") || "";
  const idToken = params.get("id_token") || "";
  if (shop || host || idToken) return true;

  const cookie = typeof document !== "undefined" ? document.cookie : "";
  const hasShopCookie = cookie.split(";").some((part) => part.trim().startsWith("sa_shop="));
  if (hasShopCookie) return true;

  try {
    const hostFromStorage = window.localStorage.getItem("shopify_host") || "";
    if (hostFromStorage) return true;
  } catch {
    // ignore storage access errors
  }

  return false;
}
