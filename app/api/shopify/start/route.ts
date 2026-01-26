import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const dest = new URL("/api/shopify/oauth/start", url.origin);

  // forward query params if present
  const shop = url.searchParams.get("shop");
  const client_id = url.searchParams.get("client_id");
  if (shop) dest.searchParams.set("shop", shop);
  if (client_id) dest.searchParams.set("client_id", client_id);

  return NextResponse.redirect(dest.toString(), 302);
}
