import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getSupabaseUserFromRequest,
  isConfiguredAdminEmail,
} from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  name: string | null;
  projectDefault?: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getSupabaseUserFromRequest(req);
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const isGlobalAdmin = isConfiguredAdminEmail(user.email);
    const allowMultiClientAdmin =
      String(process.env.NEXT_PUBLIC_ALLOW_MULTI_CLIENT_ADMIN || "").trim().toLowerCase() === "true";
    const projectDefaultClientId = String(process.env.DEFAULT_CLIENT_ID || "").trim();

    let clients: ClientRow[] = [];

    if (isGlobalAdmin) {
      const { data, error } = await admin.from("clients").select("id, name").order("name", { ascending: true });
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      clients = (data || []).map((row: any) => ({
        id: String(row.id),
        name: row.name ? String(row.name) : "Unnamed Client",
      }));
    } else {
      const { data, error } = await admin
        .from("user_clients")
        .select("client_id, clients(id, name)")
        .eq("user_id", user.id);
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      clients = ((data || []) as any[])
        .map((row) => {
          const joined = Array.isArray(row.clients) ? row.clients[0] : row.clients;
          const id = String(joined?.id || row.client_id || "").trim();
          if (!id) return null;
          return {
            id,
            name: String(joined?.name || "Unnamed Client"),
          } as ClientRow;
        })
        .filter(Boolean) as ClientRow[];
    }

    if (allowMultiClientAdmin && projectDefaultClientId) {
      const exists = clients.some((client) => client.id === projectDefaultClientId);
      if (!exists) {
        const { data: projectClient } = await admin
          .from("clients")
          .select("id, name")
          .eq("id", projectDefaultClientId)
          .limit(1)
          .maybeSingle();
        clients.unshift({
          id: projectDefaultClientId,
          name: String(projectClient?.name || "Project Default Client"),
          projectDefault: true,
        });
      } else {
        clients = clients.map((client) =>
          client.id === projectDefaultClientId ? { ...client, projectDefault: true } : client
        );
      }
    }

    return NextResponse.json({
      ok: true,
      clients,
      meta: {
        isGlobalAdmin,
        projectDefaultClientId: projectDefaultClientId || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
