// app/api/sales/summary/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const clientId = process.env.CLIENT_ID!;

  const supabase = createClient(url, serviceKey);

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { ok: false, error: "Missing start or end date" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("daily_sales_summary")
    .select("date,revenue,orders,units,aov,asp")
    .eq("client_id", clientId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    rows: data ?? [],
  });
}
