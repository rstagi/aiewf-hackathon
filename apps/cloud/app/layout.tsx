import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIA Cloud",
  description: "Self-improving agent Cloud: config registry, trace ingest, and detection dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
