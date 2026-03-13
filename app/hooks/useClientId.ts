"use client";

import { useSearchParams } from "next/navigation";

export function useClientId() {
  const params = useSearchParams();
  return params.get("client_id");
}
