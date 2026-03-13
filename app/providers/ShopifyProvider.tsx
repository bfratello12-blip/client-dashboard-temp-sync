"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";

type ShopifyProviderProps = {
  children: ReactNode;
};

export default function ShopifyProvider({ children }: ShopifyProviderProps) {
  const params = useSearchParams();

  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY;
  const host = params.get("host");

  const config = {
    apiKey,
    host,
    forceRedirect: true,
  };
  void config;

  return <>{children}</>;
}
