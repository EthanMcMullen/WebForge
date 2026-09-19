import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebForge — Describe data. Get an API.",
  description: "Turn public web data into structured, evidence-backed APIs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
