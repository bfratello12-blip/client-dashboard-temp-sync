import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, jwtVerify } from "jose";

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromDest(dest?: string) {
  if (!dest) return "";
  try {
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1] || "";

    if (!token) {
      const error = "missing token";
      console.error("[whoami] error", { error });
      return NextResponse.json({ ok: false, error }, { status: 401 });
    }

    const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET || "";
    let payload: { dest?: string } | null = null;

    if (secret) {
      try {
        const { payload: verified } = await jwtVerify(
          token,
          new TextEncoder().encode(secret)
        );
        payload = verified as { dest?: string };
      } catch {
        payload = null;
      }
    }

    if (!payload) {
      try {
        payload = decodeJwt(token) as { dest?: string };
      } catch {
        payload = null;
      }
    }

    const shop = shopFromDest(payload?.dest || "");
    if (!shop) {
      const error = "shop not found";
      console.error("[whoami] error", { error });
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }
    console.info("[whoami] ok", { shop });
    return NextResponse.json({ ok: true, shop });
  } catch (error) {
    console.error("[whoami] error", { error });
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}
