// lib/shopify/authenticatedFetch.ts
import { getSessionToken } from "@shopify/app-bridge/utilities";
import createApp from "@shopify/app-bridge";

let app: any | null = null;

function getApiKey() {
  const el = document.querySelector('meta[name="shopify-api-key"]') as HTMLMetaElement | null;
  return el?.content || "";
}

function getHost() {
  const params = new URLSearchParams(window.location.search);
  const hostFromQuery = params.get("host") || "";
  if (hostFromQuery) {
    window.localStorage.setItem("shopify_host", hostFromQuery);
    return hostFromQuery;
  }
  return window.localStorage.getItem("shopify_host") || "";
}

function getShopOrigin() {
  const params = new URLSearchParams(window.location.search);
  return params.get("shop") || "";
}

function getAppBridge() {
  if (app) return app;

  const apiKey = getApiKey();
  const host = getHost();
  const shopOrigin = getShopOrigin();

  if (!apiKey || !host) {
    // If host is missing, you are NOT in the embedded Shopify Admin URL.
    console.warn("[app-bridge] Missing apiKey/host; skipping App Bridge init", {
      hasApiKey: !!apiKey,
      hasHost: !!host,
    });
    return null;
  }

  console.debug("[AB INIT]", {
    href: window.location.href,
    host,
    shop: shopOrigin,
    inIframe: window.self !== window.top,
  });

  app = createApp({
    apiKey,
    host,
    forceRedirect: true,
  });

  return app;
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  try {
    const href = typeof input === "string" ? input : (input as Request).url || String(input);
    if (href.startsWith("/api/")) return true;
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const sameOriginApi = isSameOriginApiRequest(input);
  const app = getAppBridge();

  let token = "";
  if (sameOriginApi && app) {
    try {
      token = await getSessionToken(app);
    } catch (e) {
      console.warn("[authenticatedFetch] Failed to get session token", e);
    }
  } else if (sameOriginApi && !app) {
    console.warn("[authenticatedFetch] Missing App Bridge instance; token not attached");
  }

  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    if (process.env.NEXT_PUBLIC_DEBUG_AUTH === "1") {
      console.debug("[authenticatedFetch] attached token", {
        url: typeof input === "string" ? input : (input as Request).url,
      });
    }
  }

  const finalInit: RequestInit = {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  };

  return fetch(input, finalInit);
}
