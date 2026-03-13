// app/layout.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import ShopifyProvider from "@/app/providers/ShopifyProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ScaleAble Dashboard",
  description: "ScaleAble embedded app dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "";

  return (
    <html lang="en">
      <head>
        {/* App Bridge reads this meta */}
        <meta name="shopify-api-key" content={apiKey} />

        {/* Basic */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Suspense fallback={null}>
          <ShopifyProvider>{children}</ShopifyProvider>
        </Suspense>
      </body>
    </html>
  );
}
