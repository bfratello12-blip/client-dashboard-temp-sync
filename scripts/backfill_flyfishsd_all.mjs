import fetch from "node-fetch";

const BASE_URL = "https://client-dashboard-temp-customapp.vercel.app"; 
// change to Vercel domain if you prefer
// https://client-dashboard-temp-customapp.vercel.app

const TOKEN = "Laughing_Lab_1011";
const CLIENT_ID = "6a3a4187-b224-4942-b658-0fa23cb79eac";

const START_DATE = new Date("2022-12-11");
const END_DATE = new Date(); // today

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

async function call(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} failed: ${text}`);
  }
  return text;
}

(async () => {
  console.log("🚀 Starting FULL FlyFishSD backfill");

  let cursor = new Date(START_DATE);
  let i = 1;

  while (cursor < END_DATE) {
    const chunkStart = new Date(cursor);
    const chunkEnd = addMonths(chunkStart, 1);

    if (chunkEnd > END_DATE) chunkEnd.setTime(END_DATE.getTime());

    const start = fmt(chunkStart);
    const end = fmt(chunkEnd);

    console.log(`\n📦 Chunk ${i}: ${start} → ${end}`);

    // 1️⃣ ShopifyQL revenue (POS excluded)
    await call(
      `/api/shopify/sync?client_id=${CLIENT_ID}&start=${start}&end=${end}&mode=shopifyql`
    );
    console.log("  ✅ Revenue backfilled");

    // 2️⃣ Line items (POS excluded)
    await call(
      `/api/shopify/daily-line-items-sync?client_id=${CLIENT_ID}&start=${start}&end=${end}`
    );
    console.log("  ✅ Line items backfilled");

    // 3️⃣ Recompute profit
    await call(
      `/api/shopify/recompute?client_id=${CLIENT_ID}&start=${start}&end=${end}`
    );
    console.log("  ✅ Profit recomputed");

    cursor = chunkEnd;
    i++;
  }

  console.log("\n🎉 FULL backfill complete");
})();
