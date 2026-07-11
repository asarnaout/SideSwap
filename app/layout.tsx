import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const imageUrl = new URL("/og.png", origin).toString();

  return {
    title: "SideSwap — Practice the other side",
    description:
      "A low-poly 3D driving trainer featuring London and four other destinations for learning left- and right-side road habits before you travel.",
    applicationName: "SideSwap",
    icons: {
      icon: "/favicon.svg",
    },
    keywords: [
      "driving game",
      "left hand traffic",
      "right hand traffic",
      "travel training",
      "London driving game",
      "3D web game",
    ],
    openGraph: {
      title: "SideSwap — Practice the other side",
      description: "Start in London and build the right instincts before the road feels backwards.",
      type: "website",
      siteName: "SideSwap",
      url: origin,
      images: [
        {
          url: imageUrl,
          width: 1568,
          height: 1003,
          alt: "SideSwap low-poly London driving scene in South Kensington",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "SideSwap — Practice the other side",
      description: "Start in London and build the right instincts before the road feels backwards.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
