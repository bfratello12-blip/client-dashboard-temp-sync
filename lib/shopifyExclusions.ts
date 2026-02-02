import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ShopifyChannelExclusions = {
  excludePos: boolean;
  excludedNames: string[];
};

function normalizeNames(names: any): string[] {
  if (!Array.isArray(names)) return [];
  return names
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0);
}

export async function loadShopifyChannelExclusions(clientId: string): Promise<ShopifyChannelExclusions> {
  if (!clientId) return { excludePos: false, excludedNames: [] };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("clients")
    .select("shopify_exclude_pos, shopify_excluded_sales_channel_names")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return { excludePos: false, excludedNames: [] };

  return {
    excludePos: Boolean((data as any).shopify_exclude_pos),
    excludedNames: normalizeNames((data as any).shopify_excluded_sales_channel_names),
  };
}
