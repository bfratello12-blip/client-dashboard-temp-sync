"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    const redirectRaw = (searchParams.get("redirect") || "").trim();
    const safeRedirect = redirectRaw.startsWith("/") ? redirectRaw : "";
    if (safeRedirect) {
      router.push(safeRedirect);
      return;
    }

    const qs = new URLSearchParams();
    const clientId = (searchParams.get("client_id") || "").trim();
    const shop = (searchParams.get("shop") || "").trim();
    const shopDomain = (searchParams.get("shop_domain") || "").trim();
    const host = (searchParams.get("host") || "").trim();
    const embedded = (searchParams.get("embedded") || "").trim();
    if (clientId) qs.set("client_id", clientId);
    if (shop) qs.set("shop", shop);
    if (shopDomain) qs.set("shop_domain", shopDomain);
    if (host) qs.set("host", host);
    if (embedded) qs.set("embedded", embedded);

    const query = qs.toString();
    router.push(query ? `/?${query}` : "/");
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Client Login</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in to view your dashboard
        </p>

        <div className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border p-3"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full rounded-xl border p-3"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            onClick={signIn}
            disabled={loading || !email || !password}
            className="w-full rounded-xl bg-slate-900 py-3 text-white font-semibold disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>
    </main>
  );
}

