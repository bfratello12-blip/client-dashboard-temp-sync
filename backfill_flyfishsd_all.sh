#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://client-dashboard-temp-customapp.vercel.app"
TOKEN="Laughing_Lab_1011"
CLIENT_ID="6a3a4187-b224-4942-b658-0fa23cb79eac"

START_DATE="2022-12-11"
END_DATE="$(date +%F)"   # today

log() { echo "[$(date +'%F %T')] $*"; }

post() {
  local url="$1"
  log "POST $url"
  curl -sS -X POST -H "Authorization: Bearer ${TOKEN}" "$url"
  echo
}

# Month start/end helpers using python (portable)
month_start() {
  python - <<'PY'
import sys, datetime
d=datetime.date.fromisoformat(sys.argv[1])
print(d.replace(day=1).isoformat())
PY
}

month_end() {
  python - <<'PY'
import sys, datetime, calendar
d=datetime.date.fromisoformat(sys.argv[1])
last=calendar.monthrange(d.year,d.month)[1]
print(datetime.date(d.year,d.month,last).isoformat())
PY
}

add_months() {
  python - <<'PY'
import sys, datetime
from dateutil.relativedelta import relativedelta
d=datetime.date.fromisoformat(sys.argv[1])
n=int(sys.argv[2])
print((d+relativedelta(months=n)).isoformat())
PY
}

min_date() {
  python - <<'PY'
import sys, datetime
a=datetime.date.fromisoformat(sys.argv[1])
b=datetime.date.fromisoformat(sys.argv[2])
print(min(a,b).isoformat())
PY
}

log "Starting FULL backfill (ALL DATA) for FlyFishSD"
log "Range: ${START_DATE} → ${END_DATE}"

CUR="${START_DATE}"

while true; do
  # stop if CUR > END_DATE
  stop="$(python - <<'PY'
import sys, datetime
cur=datetime.date.fromisoformat(sys.argv[1])
end=datetime.date.fromisoformat(sys.argv[2])
print("1" if cur>end else "0")
PY
"${CUR}" "${END_DATE}")"
  [[ "$stop" == "1" ]] && break

  M_START="$(month_start "${CUR}")"
  M_END="$(month_end "${CUR}")"
  CHUNK_START="${CUR}"
  CHUNK_END="$(min_date "${M_END}" "${END_DATE}")"

  log "=============================="
  log "Chunk: ${CHUNK_START} → ${CHUNK_END}"
  log "=============================="

  # 1) Canonical revenue via ShopifyQL (POS-excluded for this client)
  resp="$(post "${BASE_URL}/api/shopify/sync?client_id=${CLIENT_ID}&start=${CHUNK_START}&end=${CHUNK_END}&mode=shopifyql")"
  log "Revenue (ShopifyQL) response: ${resp}"

  # 2) OPTIONAL: orders-based sync for orders count + any non-ShopifyQL fields your sync writes.
  # If your orders-mode sync overwrites revenue, you should SKIP this.
  # If your code merges safely or only writes orders, keep it.
  resp="$(post "${BASE_URL}/api/shopify/sync?client_id=${CLIENT_ID}&start=${CHUNK_START}&end=${CHUNK_END}&mode=orders")"
  log "Orders-mode sync response: ${resp}"

  # 3) Daily line items + unit costs (requires read_all_orders — you said you have it)
  resp="$(post "${BASE_URL}/api/shopify/daily-line-items-sync?client_id=${CLIENT_ID}&start=${CHUNK_START}&end=${CHUNK_END}")"
  log "Line-items sync response: ${resp}"

  # 4) Recompute profit summary + coverage
  resp="$(post "${BASE_URL}/api/shopify/recompute?client_id=${CLIENT_ID}&start=${CHUNK_START}&end=${CHUNK_END}")"
  log "Recompute response: ${resp}"

  # advance to first day of next month
  NEXT_MONTH="$(add_months "${M_START}" 1)"
  CUR="${NEXT_MONTH}"

  # If we ended early because END_DATE mid-month, we're done
  if [[ "${CHUNK_END}" == "${END_DATE}" ]]; then
    break
  fi
done

log "🎉 FULL backfill complete."
