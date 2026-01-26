import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const secret = new TextEncoder().encode(
      process.env.SHOPIFY_OAUTH_CLIENT_SECRET!
    );

    await jwtVerify(token, secret, {
      audience: process.env.SHOPIFY_OAUTH_CLIENT_ID,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
