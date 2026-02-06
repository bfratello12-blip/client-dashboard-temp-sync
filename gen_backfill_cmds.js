// gen_backfill_cmds.js
// Usage:
//   node gen_backfill_cmds.js "https://YOUR_DOMAIN" "YOUR_CLIENT_ID" "YOUR_TOKEN" "2023-01-01" "2026-01-31"
//
// Example:
//   node gen_backfill_cmds.js "https://scaleable-dashboard-wildwater.vercel.app" "f298..." "Laughing_Lab_1011" "2023-01-01" "2026-01-31"

const [base, clientId, token, startArg, endArg] = process.argv.slice(2);

if (!base || !clientId || !token) {
  console.error(
    'Usage: node gen_backfill_cmds.js "https://DOMAIN" "CLIENT_ID" "TOKEN" "YYYY-MM-DD" "YYYY-MM-DD"'
  );
  process.exit(1);
}

const START = new Date(`${startArg || "2023-01-01"}T00:00:00Z`);
const END = new Date(`${endArg || "2026-01-31"}T00:00:00Z`);

function iso(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function endOfMonth(d) {
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
console.log(`# Range: ${iso(START)} -> ${iso(END)}`);
console.log(`# Method: daily-sync per month (includes shopify+google+meta+line-items+recompute+rolling30)`);
console.log("");

console.log(`# (Recommended) Run ONE month first to sanity check:`);
const firstMonth = [...monthRanges(START, END)][0];
if (firstMonth) {
  const [s, e] = firstMonth;
  console.log(`curl -i "${base}/api/cron/daily-sync?client_id=${clientId}&start=${s}&end=${e}&token=${token}"`);
  console.log("");
}

for (const [s, e] of monthRanges(START, END)) {
  console.log(`echo "===== ${s} to ${e} ====="`);
  console.log(
    `curl -sS -i "${base}/api/cron/daily-sync?client_id=${clientId}&start=${s}&end=${e}&token=${token}"`
  );
  console.log("");
}

console.log(`# After all months, run daily-sync once with no params to normalize last 30 days:`);
console.log(`curl -i "${base}/api/cron/daily-sync?client_id=${clientId}&token=${token}"`);
