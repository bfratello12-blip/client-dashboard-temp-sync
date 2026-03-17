import { decodeJwt, jwtVerify } from "jose";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromDest(dest?: string) {
  if (!dest) return "";
  try {
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

export function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] || "").trim();
}

export async function shopFromSessionToken(token: string): Promise<string> {
  if (!token) return "";

  const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET || "";
  let payload: { dest?: string } | null = null;

  if (secret) {
    try {
      const { payload: verified } = await jwtVerify(token, new TextEncoder().encode(secret));
      payload = verified as { dest?: string };
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = decodeJwt(token) as { dest?: string };
    } catch {
      payload = null;
    }
  }

  return shopFromDest(payload?.dest || "");
}

function parseCookies(cookieHeader: string) {
  const out = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out.set(key, value);
  }
  return out;
}

function decodeCookieValue(raw: string) {
  const unquoted = raw.replace(/^"|"$/g, "");
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

function extractTokenFromSbAuthCookieValue(value: string): string[] {
  const decoded = decodeCookieValue(value);
  const out: string[] = [];

  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0]) {
      out.push(parsed[0]);
    } else if (parsed && typeof parsed === "object") {
      const accessToken = (parsed as any).access_token;
      if (typeof accessToken === "string" && accessToken) out.push(accessToken);
    }
  } catch {
    // ignore JSON parse error
  }

  if (decoded.split(".").length === 3) out.push(decoded);

  return out;
}

function extractSupabaseTokensFromRequest(req: Request): string[] {
  const tokens: string[] = [];
  const bearer = getBearerToken(req);
  if (bearer) tokens.push(bearer);

  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);

  const directToken = cookies.get("sb-access-token") || cookies.get("supabase-access-token") || "";
  if (directToken) tokens.push(decodeCookieValue(directToken));

  for (const [name, value] of cookies.entries()) {
    if (name.startsWith("sb-") && name.endsWith("-auth-token")) {
      tokens.push(...extractTokenFromSbAuthCookieValue(value));
    }
  }

  return Array.from(new Set(tokens.filter(Boolean)));
}

export async function getSupabaseUserIdFromRequest(req: Request): Promise<string | null> {
  const user = await getSupabaseUserFromRequest(req);
  return user?.id || null;
}

export async function getSupabaseUserFromRequest(
  req: Request
): Promise<{ id: string; email: string | null } | null> {
  const supabase = supabaseAdmin();
  const tokens = extractSupabaseTokensFromRequest(req);

  for (const token of tokens) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user?.id) {
        return {
          id: data.user.id,
          email: data.user.email || null,
        };
      }
    } catch {
      // try next token
    }
  }

  return null;
}

export function getConfiguredAdminEmails(): string[] {
  const raw = String(process.env.ADMIN_EMAILS || process.env.SUPPORT_ADMIN_EMAILS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isConfiguredAdminEmail(email: string | null | undefined): boolean {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  return getConfiguredAdminEmails().includes(normalized);
}

export async function getInstallClientIdForShop(shop: string): Promise<string | null> {
  if (!shop) return null;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("shopify_app_installs")
    .select("client_id")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (error || !data?.client_id) return null;
  return String(data.client_id);
}

export async function resolveClientIdFromShopDomainParam(shopDomainRaw: string): Promise<string | null> {
  const shop = normalizeShopDomain(String(shopDomainRaw || ""));
  if (!shop) return null;
  return getInstallClientIdForShop(shop);
}

export async function getShopFromRequest(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) return "";
  return shopFromSessionToken(token);
}

export async function supabaseUserHasClientAccess(userId: string, clientId: string): Promise<boolean> {
  if (!userId || !clientId) return false;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("user_clients")
    .select("client_id")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .limit(1);

  if (error) return false;
  return Boolean(data?.length);
}

export async function getFirstClientIdForSupabaseUser(userId: string): Promise<string | null> {
  if (!userId) return null;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("user_clients")
    .select("client_id")
    .eq("user_id", userId)
    .limit(1);

  if (error || !data?.length || !(data[0] as any)?.client_id) return null;
  return String((data[0] as any).client_id);
}

export async function isRequestAuthorizedForClient(req: Request, clientId: string): Promise<boolean> {
  const requestedClientId = String(clientId || "").trim();
  if (!requestedClientId) return false;

  const shop = await getShopFromRequest(req);
  if (shop) {
    const installClientId = await getInstallClientIdForShop(shop);
    if (installClientId && String(installClientId) === requestedClientId) {
      return true;
    }
  }

  const userId = await getSupabaseUserIdFromRequest(req);
  if (!userId) return false;
  return supabaseUserHasClientAccess(userId, requestedClientId);
}
