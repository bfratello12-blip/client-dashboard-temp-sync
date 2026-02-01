// gen_backfill_cmds.js
// Usage:
//   node gen_backfill_cmds.js "https://YOUR_DOMAIN" "YOUR_CLIENT_ID" "YOUR_TOKEN"
//
// Example:
//   node gen_backfill_cmds.js "https://scaleable-dashboard-wildwater.vercel.app" "f298..." "Laughing_Lab_1011"

const [base, clientId, token] = process.argv.slice(2);
if (!base || !clientId || !token) {
  console.error('Usage: node gen_backfill_cmds.js "https://DOMAIN" "CLIENT_ID" "TOKEN"');
  process.exit(1);
}

if (!process.stdout.isTTY) {
  console.error("[gen_backfill_cmds] stdout is not a TTY; generating script to stdout...");
}

const START = new Date("2023-01-01T00:00:00Z");
const END = new Date("2026-01-31T00:00:00Z");

function iso(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function endOfMonth(d) {
  // last day of month
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function* monthRanges(start, end) {
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const s = new Date(cur);
    const e = endOfMonth(cur);
    const endClamped = e > end ? end : e;
    yield [iso(s), iso(endClamped)];
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
}

console.log(`# Base: ${base}`);
console.log(`# Client: ${clientId}`);
console.log(`# Range: 2023-01-01 -> 2026-01-31`);
console.log("");

console.log(`# (Optional) sanity check: run ONE month first (2023-01) before full run.`);
console.log("");

for (const [s, e] of monthRanges(START, END)) {
  console.log(`echo "===== ${s} to ${e} ====="`);

  // 1) Shopify daily_metrics
  console.log(
    `curl -sS -X POST "${base}/api/shopify/sync?client_id=${clientId}&start=${s}&end=${e}&force=1" -H "Content-Type: application/json"`
  );

  // 2) Google daily_metrics
  console.log(
    `curl -sS -X POST "${base}/api/googleads/sync?client_id=${clientId}&start=${s}&end=${e}&fillZeros=1" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json"`
  );

  // 3) Meta daily_metrics
  console.log(
    `curl -sS -X POST "${base}/api/meta/sync?client_id=${clientId}&start=${s}&end=${e}&fillZeros=1" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json"`
  );

  // 4) Line items + unit costs
  console.log(
    `curl -sS -X POST "${base}/api/shopify/daily-line-items-sync?client_id=${clientId}&start=${s}&end=${e}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json"`
  );

  // 5) Recompute (profit + coverage tables)
  console.log(
    `curl -sS -X POST "${base}/api/shopify/recompute?start=${s}&end=${e}&token=${token}" -H "Content-Type: application/json"`
  );

  // 6) Rolling-30 aggregator (for that month window)
  console.log(
    `curl -sS -X POST "${base}/api/cron/rolling-30?client_id=${clientId}&start=${s}&end=${e}&token=${token}" -H "Content-Type: application/json"`
  );

  console.log("");
}

console.log(`# After all months, run daily-sync once to normalize last 30 days:`);
console.log(`curl -i "${base}/api/cron/daily-sync?client_id=${clientId}&token=${token}"`);
