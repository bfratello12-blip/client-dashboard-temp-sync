import { GET as handler } from "@/app/api/campaign-performance/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler;
