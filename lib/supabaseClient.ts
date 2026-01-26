// lib/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is required");
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");

  _client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: true },
  });

  return _client;
}

/**
 * Convenience proxy that won’t eagerly init during import.
 */
export const supabase: SupabaseClient = new Proxy(
  {},
  {
    get(_t, prop) {
      const c = getSupabaseClient();
      return (c as any)[prop];
    },
  }
) as SupabaseClient;




