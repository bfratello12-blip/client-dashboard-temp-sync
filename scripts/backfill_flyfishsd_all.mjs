import fetch from "node-fetch";
import fs from "fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.TOKEN || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const INCLUDE_REVENUE_SYNC = String(process.env.INCLUDE_REVENUE_SYNC || "").toLowerCase() === "true";

const START_DATE = new Date(process.env.START_DATE || "2022-12-11");
const END_DATE = new Date(); // today

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (CLIENT_ID) {
    fs.appendFileSync(`backfill_${CLIENT_ID}.log`, `${line}\n`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
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

async function callWithRetry(path, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await call(path);
    } catch (e) {
      attempt += 1;
      if (attempt >= maxRetries) throw e;
      const waitMs = Math.pow(2, attempt) * 500;
      logLine(`⚠️  Retry ${attempt}/${maxRetries} after ${waitMs}ms: ${path}`);
      await sleep(waitMs);
    }
  }
}

(async () => {
  if (!TOKEN || !CLIENT_ID) {
    throw new Error("Missing TOKEN or CLIENT_ID env vars");
  }

  logLine("🚀 Starting recompute backfill");

  let cursor = new Date(START_DATE);
  let i = 1;

  while (cursor < END_DATE) {
    const chunkStart = new Date(cursor);
    const chunkEnd = addMonths(chunkStart, 1);

    if (chunkEnd > END_DATE) chunkEnd.setTime(END_DATE.getTime());

    const start = fmt(chunkStart);
    const end = fmt(chunkEnd);

    logLine(`📦 Chunk ${i}: ${start} → ${end}`);

    if (INCLUDE_REVENUE_SYNC) {
      await callWithRetry(
        `/api/shopify/sync?client_id=${CLIENT_ID}&start=${start}&end=${end}&mode=shopifyql`
      );
      logLine("✅ Revenue backfilled");
    }

    await callWithRetry(
      `/api/shopify/daily-line-items-sync?client_id=${CLIENT_ID}&start=${start}&end=${end}`
    );
    logLine("✅ Line items backfilled");

    await callWithRetry(
      `/api/shopify/recompute?client_id=${CLIENT_ID}&start=${start}&end=${end}`
    );
    logLine("✅ Profit recomputed");

    cursor = chunkEnd;
    i++;
  }

  logLine("🎉 Recompute backfill complete");
})();
