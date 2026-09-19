import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebForge — Describe data. Get an API.",
  description: "Plan structured web-data APIs from natural-language requests.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
