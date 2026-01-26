import { NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function verifyHmac(rawBody: string, hmac: string, secret: string) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  if (digest.length !== hmac.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmac)
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") || "";
  const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET!;

  if (!hmac || !verifyHmac(rawBody, hmac, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response("OK", { status: 200 });
}
