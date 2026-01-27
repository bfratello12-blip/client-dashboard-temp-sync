// lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : undefined;
}

/**
 * Service-role Supabase client for server-side cron/sync routes.
 * Never initialize at module scope. Only create at runtime.
 */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  _admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return _admin;
}

// Backwards-compatible export for existing imports
export const getSupabaseAdmin = supabaseAdmin;









