// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              const params = new URLSearchParams(window.location.search);
              const isShopifyEmbedded =
                params.has("shop") || params.has("host") || params.has("embedded");

              if (isShopifyEmbedded) {
                const script = document.createElement("script");
                script.src = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
                document.head.appendChild(script);
              }
            `,
          }}
        />

        {/* App Bridge reads this meta */}
        <meta name="shopify-api-key" content={apiKey} />

        {/* Basic */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
