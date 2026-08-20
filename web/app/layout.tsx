import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuclide Explorer",
  description:
    "Interactive chart of every known nuclide, built on the IAEA Livechart API over ENSDF. Explore half-lives, decay modes, and decay chains to stability.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
