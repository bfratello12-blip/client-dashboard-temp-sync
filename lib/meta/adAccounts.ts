export type MetaAdAccount = { id: string; name: string };

export function normalizeMetaAdAccountId(id: string): string {
  const trimmed = String(id || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

export async function fetchMetaAdAccounts(args: {
  accessToken: string;
  apiVersion?: string;
}): Promise<MetaAdAccount[]> {
  const apiVersion = args.apiVersion || "v19.0";
  const params = new URLSearchParams();
  params.set("fields", "id,name,account_status");
  params.set("limit", "200");
  params.set("access_token", args.accessToken);

  const url = `https://graph.facebook.com/${apiVersion}/me/adaccounts?${params.toString()}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `Meta API error (${res.status})`;
    throw new Error(msg);
  }

  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((row: any) => {
      const id = normalizeMetaAdAccountId(row?.id ?? "");
      const name = String(row?.name ?? "").trim();
      return id ? { id, name } : null;
    })
    .filter(Boolean) as MetaAdAccount[];
}
