export function hasShopifyContextClient(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop") || "";
  const host = params.get("host") || "";
  const idToken = params.get("id_token") || "";
  if (shop || host || idToken) return true;

  try {
    const storedHost = window.localStorage.getItem("shopify.host") || "";
    if (storedHost) return true;
  } catch {
    // ignore storage access issues
  }

  const cookie = typeof document !== "undefined" ? document.cookie || "" : "";
  return /(?:^|;\s*)sa_shop=/.test(cookie);
}
