import { isoDateUTC } from "@/lib/dates";

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

export async function runUnifiedSync(args: {
  origin: string;
  clientId: string;
  start?: string;
  end?: string;
  token?: string;
}): Promise<{ ok: boolean; client_id: string; steps: StepSummary[]; status?: number }> {
  const window = buildWindow(args.start, args.end);

  const secret = String(args.token || "").trim();
  const authHeader = secret ? { Authorization: `Bearer ${secret}` } : undefined;

  const steps: StepSummary[] = [];

  const shopifyParams = new URLSearchParams({
    client_id: args.clientId,
    start: window.start,
    end: window.end,
    force: "1",
  });
  if (secret) shopifyParams.set("token", secret);
  const shopifyUrl = `${args.origin}/api/shopify/sync?${shopifyParams.toString()}`;
  const shopify = await runStep({ step: "shopify_sync", url: shopifyUrl, headers: authHeader });
  steps.push(shopify.summary);
  if (!shopify.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: shopify.summary.status || 500 };
  }

  const googleParams = new URLSearchParams({
    client_id: args.clientId,
    start: window.start,
    end: window.end,
    fillZeros: "1",
  });
  if (secret) googleParams.set("token", secret);
  const googleUrl = `${args.origin}/api/googleads/sync?${googleParams.toString()}`;
  const google = await runStep({ step: "googleads_sync", url: googleUrl, headers: authHeader, method: "GET" });
  steps.push(google.summary);
  if (!google.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: google.summary.status || 500 };
  }

  const metaParams = new URLSearchParams({
    client_id: args.clientId,
    start: window.start,
    end: window.end,
    fillZeros: "1",
  });
  if (secret) metaParams.set("token", secret);
  const metaUrl = `${args.origin}/api/meta/sync?${metaParams.toString()}`;
  const meta = await runStep({ step: "meta_sync", url: metaUrl, headers: authHeader, method: "GET" });
  steps.push(meta.summary);
  if (!meta.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: meta.summary.status || 500 };
  }

  const lineItemsParams = new URLSearchParams({
    client_id: args.clientId,
    start: window.start,
    end: window.end,
  });
  if (secret) lineItemsParams.set("token", secret);
  const lineItemsUrl = `${args.origin}/api/shopify/daily-line-items-sync?${lineItemsParams.toString()}`;
  const lineItems = await runStep({ step: "shopify_daily_line_items", url: lineItemsUrl, headers: authHeader });
  steps.push(lineItems.summary);
  if (!lineItems.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: lineItems.summary.status || 500 };
  }

  const recomputeParams = new URLSearchParams({
    client_id: args.clientId,
    token: secret,
    start: window.start,
    end: window.end,
  });
  const recomputeUrl = `${args.origin}/api/shopify/recompute?${recomputeParams.toString()}`;
  const recompute = await runStep({ step: "shopify_recompute", url: recomputeUrl, headers: authHeader });
  steps.push(recompute.summary);
  if (!recompute.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: recompute.summary.status || 500 };
  }

  const rollingParams = new URLSearchParams({
    client_id: args.clientId,
    start: window.start,
    end: window.end,
    token: secret,
    skipSyncs: "1",
  });
  const rollingUrl = `${args.origin}/api/cron/rolling-30?${rollingParams.toString()}`;
  const rolling = await runStep({ step: "rolling_30", url: rollingUrl, headers: authHeader });
  steps.push(rolling.summary);
  if (!rolling.summary.ok) {
    return { ok: false, client_id: args.clientId, steps, status: rolling.summary.status || 500 };
  }

  return { ok: true, client_id: args.clientId, steps };
}
