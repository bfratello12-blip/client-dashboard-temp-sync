// lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : undefined;
}

function isBuildPhase(): boolean {
  // Next.js sets NEXT_PHASE in builds (varies by version), this is a safe guard
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Service-role Supabase client for server-side cron/sync routes.
 * Never initialize at module scope. Only create at runtime.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  // Avoid breaking build if something imports this file during build-time
  if (isBuildPhase()) {
    // Create a client with dummy values ONLY if someone accidentally calls during build
    // (but we still throw because routes need real env vars at runtime)
  }

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  _admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return _admin;
}









