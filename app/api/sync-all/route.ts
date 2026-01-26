import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Placeholder route so Next.js treats this as a module.
 * Add orchestration logic later if needed.
 */
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/sync-all" });
}
