// lib/shopify/authenticatedFetch.ts
import { getSessionToken } from "@shopify/app-bridge-utils";
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
    throw new Error(`Missing apiKey/host. apiKey=${!!apiKey} host=${!!host}`);
  }

  app = createApp({
    apiKey,
    host,
    forceRedirect: true,
  });

  return app;
}

export async function authenticatedFetch(input: string, init: RequestInit = {}) {
  const app = getAppBridge();
  const token = await getSessionToken(app);

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
