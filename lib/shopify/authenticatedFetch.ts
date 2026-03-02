// lib/shopify/authenticatedFetch.ts
import { getSessionToken } from "@shopify/app-bridge/utilities";
import createApp from "@shopify/app-bridge";

let app: any | null = null;

function getApiKey() {
  const el = document.querySelector('meta[name="shopify-api-key"]') as HTMLMetaElement | null;
  return el?.content || "";
}

function getHost() {
  return new URLSearchParams(window.location.search).get("host") || "";
}

function getAppBridge() {
  if (app) return app;

  const apiKey = getApiKey();
  const host = getHost();

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
    shop: new URLSearchParams(window.location.search).get("shop") || "",
    inIframe: window.self !== window.top,
  });

  app = createApp({
    apiKey,
    host,
    forceRedirect: true,
  });

  return app;
}

export async function authenticatedFetch(input: string, init: RequestInit = {}) {
  const app = getAppBridge();
  if (!app) {
    return fetch(input, init);
  }
  const token = await getSessionToken(app);

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
