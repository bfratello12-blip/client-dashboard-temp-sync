import { isoDateUTC } from "@/lib/dates";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type StepSummary = {
  step: string;
  ok: boolean;
  status: number;
  daysWritten?: number;
  rowsWritten?: number;
  error?: string;
};

type SyncWindow = { start: string; end: string };

function buildWindow(start?: string, end?: string): SyncWindow {
  if (start && end) return { start, end };
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  endDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  return { start: isoDateUTC(startDate), end: isoDateUTC(endDate) };
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function pickCounts(body: any) {
  const daysWritten = Number(body?.daysWritten);
  if (Number.isFinite(daysWritten)) return { daysWritten };
  const rowsWritten = Number(body?.rowsWritten);
  if (Number.isFinite(rowsWritten)) return { rowsWritten };
  const rowsSynced = Number(body?.rows_synced);
  if (Number.isFinite(rowsSynced)) return { rowsWritten: rowsSynced };
  return {};
}

async function runStep(args: {
  step: string;
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
}) {
  const res = await fetch(args.url, {
    method: args.method ?? "POST",
    headers: args.headers,
  });
  const body = await safeJson(res);
  const ok = res.ok && (body?.ok !== false);
  const summary: StepSummary = {
    step: args.step,
    ok,
    status: res.status,
    ...pickCounts(body),
  };
  if (!ok) {
    summary.error = body?.error || body?.message || `HTTP ${res.status}`;
  }
  return { res, body, summary };
}

async function resolveShopDomainFromClientId(clientId: string) {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("shopify_app_installs")
    .select("shop_domain")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve shop_domain for client_id ${clientId}: ${error.message}`);
  }

  return String(data?.shop_domain || "").trim().toLowerCase();
}

export async function runUnifiedSync(args: {
  origin: string;
  clientId: string;
  start?: string;
  end?: string;
  token?: string;
}): Promise<{ ok: boolean; client_id: string; steps: StepSummary[]; status?: number }> {
  const window = buildWindow(args.start, args.end);
  const shopDomain = await resolveShopDomainFromClientId(args.clientId);

  if (!shopDomain) {
    return {
      ok: false,
      client_id: args.clientId,
      status: 400,
      steps: [
        {
          step: "resolve_shop_domain",
          ok: false,
          status: 400,
          error: `No shop_domain found for client_id ${args.clientId}`,
        },
      ],
    };
  }

  const secret = String(args.token || "").trim();
  const authHeader = secret ? { Authorization: `Bearer ${secret}` } : undefined;

  async function syncShopifyChannelMetrics(resolvedShopDomain: string, start: string, end: string) {
    const params = new URLSearchParams({
      shop_domain: resolvedShopDomain,
      start,
      end,
    });
    if (secret) params.set("token", secret);
    const url = `${args.origin}/api/shopify/channel-sync?${params.toString()}`;
    return runStep({ step: "shopify_channel_sync", url, headers: authHeader, method: "GET" });
  }

  const steps: StepSummary[] = [];

  const shopifyParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
    force: "1",
  });
  if (secret) shopifyParams.set("token", secret);
  const shopifyUrl = `${args.origin}/api/shopify/sync?${shopifyParams.toString()}`;
  const shopify = await runStep({ step: "shopify_sync", url: shopifyUrl, headers: authHeader });
  steps.push(shopify.summary);

  const channelSync = await syncShopifyChannelMetrics(shopDomain, window.start, window.end);
  steps.push(channelSync.summary);

  const googleParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
    fillZeros: "1",
  });
  if (secret) googleParams.set("token", secret);
  const googleUrl = `${args.origin}/api/googleads/sync?${googleParams.toString()}`;
  const google = await runStep({ step: "googleads_sync", url: googleUrl, headers: authHeader, method: "GET" });
  steps.push(google.summary);

  const metaParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
    fillZeros: "1",
  });
  if (secret) metaParams.set("token", secret);
  const metaUrl = `${args.origin}/api/meta/sync?${metaParams.toString()}`;
  const meta = await runStep({ step: "meta_sync", url: metaUrl, headers: authHeader, method: "GET" });
  steps.push(meta.summary);

  const lineItemsParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
  });
  if (secret) lineItemsParams.set("token", secret);
  const lineItemsUrl = `${args.origin}/api/shopify/daily-line-items-sync?${lineItemsParams.toString()}`;
  const lineItems = await runStep({ step: "shopify_daily_line_items", url: lineItemsUrl, headers: authHeader });
  steps.push(lineItems.summary);

  const recomputeParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
  });
  if (secret) recomputeParams.set("token", secret);
  const recomputeUrl = `${args.origin}/api/shopify/recompute?${recomputeParams.toString()}`;
  const recompute = await runStep({ step: "shopify_recompute", url: recomputeUrl, headers: authHeader });
  steps.push(recompute.summary);

  const rollingParams = new URLSearchParams({
    shop_domain: shopDomain,
    start: window.start,
    end: window.end,
    skipSyncs: "1",
  });
  if (secret) rollingParams.set("token", secret);
  const rollingUrl = `${args.origin}/api/cron/rolling-30?${rollingParams.toString()}`;
  const rolling = await runStep({ step: "rolling_30", url: rollingUrl, headers: authHeader });
  steps.push(rolling.summary);

  const firstFailed = steps.find((s) => !s.ok);
  if (firstFailed) {
    return {
      ok: false,
      client_id: args.clientId,
      steps,
      status: firstFailed.status || 500,
    };
  }

  return { ok: true, client_id: args.clientId, steps };
}
