import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const dest = new URL("/api/shopify/oauth/start", url.origin);

  // forward query params if present
  const shop = url.searchParams.get("shop");
  const shop_domain = url.searchParams.get("shop_domain");
  if (shop) dest.searchParams.set("shop", shop);
  if (shop_domain) dest.searchParams.set("shop_domain", shop_domain);

  return NextResponse.redirect(dest.toString(), 302);
}
