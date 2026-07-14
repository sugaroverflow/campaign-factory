import type { Metadata } from "next";
import { Inter_Tight, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./journey.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

// Awake pairing: Inter Tight (sans) + Instrument Serif (italic display accents).
const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campaign Factory",
  description: "Turn a UK local problem into a whole campaign — researched live, with every claim labelled.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteNav />
        <div className="flex-1 pt-14">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
