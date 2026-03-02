export function hasShopifyContextClient(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop") || "";
  const host = params.get("host") || "";
  const idToken = params.get("id_token") || "";
  if (shop || host || idToken) return true;

  return false;
}
