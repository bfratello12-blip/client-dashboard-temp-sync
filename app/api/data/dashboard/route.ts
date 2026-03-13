import { GET as handler } from "@/app/api/data/daily-metrics/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler;
