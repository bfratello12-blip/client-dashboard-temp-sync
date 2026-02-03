// scripts/backfill_flyfishsd_all.mjs
// One-shot monthly backfill: ShopifyQL revenue (POS excluded) + line items + recompute
// Run: node scripts/backfill_flyfishsd_all.mjs > backfill_flyfishsd_all.log 2>&1

const BASE_URL = process.env.BASE_URL || "https://client-dashboard-temp-customapp.vercel.app";
const TOKEN = process.env.TOKEN || "Laughing_Lab_1011";
const CLIENT_ID = process.env.CLIENT_ID || "6a3a4187-b224-4942-b658-0fa23cb79eac";

const START_DATE = process.env.START_DATE || "2022-12-11";
const END_DATE = process.env.END_DATE || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const RETRIES = 5;
const RETRY_DELAY_MS = 2500;
const SLEEP_BETWEEN_CALLS_MS = 250;   // helps with rate limits a bit
const SLEEP_BETWEEN_CHUNKS_MS = 1000; // helps keep Shopify happy

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function monthStart(dateUtc) {
  return new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), 1));
}
function monthEnd(dateUtc) {
  return new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth() + 1, 0));
}
function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}
function addMonths(dateUtc, n) {
  return new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth() + n, 1));
}

function chunkRangesMonthly(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  if (start > end) throw new Error("START_DATE > END_DATE");

  const ranges = [];
  let cur = start;

  while (cur <= end) {
    const ms = monthStart(cur);
    const me = monthEnd(cur);

    const chunkStart = cur; // first month can start mid-month (12/11)
    const chunkEnd = minDate(me, end);

    ranges.push({ start: fmtDate(chunkStart), end: fmtDate(chunkEnd) });

    cur = addMonths(ms, 1); // first of next month
  }
  return ranges;
}

async function postJson(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: "non_json_response", raw: text };
  }

  if (!res.ok || json?.ok === false) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.details = json;
    throw err;
  }
  return json;
}

async function callWithRetry(url, label) {
  for (let i = 1; i <= RETRIES; i++) {
    try {
      log(`${label}: POST ${url}`);
      const json = await postJson(url);
      log(`${label}: ok`);
      await sleep(SLEEP_BETWEEN_CALLS_MS);
      return json;
    } catch (e) {
      log(`${label}: ERROR attempt ${i}/${RETRIES}: ${e.message}`);
      if (e.details) log(`${label}: details ${JSON.stringify(e.details).slice(0, 1500)}`);
      if (i === RETRIES) throw e;
      await sleep(RETRY_DELAY_MS * i);
    }
  }
}

async function run() {
  log("Starting FULL backfill (ShopifyQL revenue + line items + recompute)");
  log(`BASE_URL=${BASE_URL}`);
  log(`CLIENT_ID=${CLIENT_ID}`);
  log(`Range: ${START_DATE} → ${END_DATE}`);

  const ranges = chunkRangesMonthly(START_DATE, END_DATE);
  log(`Chunks: ${ranges.length}`);

  for (const [idx, r] of ranges.entries()) {
    const label = `Chunk ${idx + 1}/${ranges.length} ${r.start}→${r.end}`;
    log("========================================");
    log(label);
    log("========================================");

    // 1) Revenue via ShopifyQL (POS exclusion applied by client settings)
    await callWithRetry(
      `${BASE_URL}/api/shopify/sync?client_id=${CLIENT_ID}&start=${r.start}&end=${r.end}&mode=shopifyql`,
      `${label} revenue(shopifyql)`
    );

    // 2) Daily line items + unit costs (read_all_orders required - you said you have it)
    await callWithRetry(
      `${BASE_URL}/api/shopify/daily-line-items-sync?client_id=${CLIENT_ID}&start=${r.start}&end=${r.end}`,
      `${label} line-items`
    );

    // 3) Recompute profit summary + coverage
    await callWithRetry(
      `${BASE_URL}/api/shopify/recompute?client_id=${CLIENT_ID}&start=${r.start}&end=${r.end}`,
      `${label} recompute`
    );

    await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }

  log("🎉 FULL backfill complete.");
}

run().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
