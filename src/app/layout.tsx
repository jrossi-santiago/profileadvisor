import type { Metadata } from "next";
import { SimulationBanner } from "@/components/simulation-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talk-To — chat with an AI simulation of a public X account",
  description:
    "Paste a public X handle and chat with an AI simulation built from that account's public posts. Not the real person.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SimulationBanner />
        {children}
      </body>
    </html>
  );
}
