import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { sql } from "@/lib/db";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: "Someday",
  description: "Everything you saved, finally findable.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Someday", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-180.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6efe3" }, { media: "(prefers-color-scheme: dark)", color: "#1d1712" }],
};

// Items still being processed show as a small badge on Saved instead of their own nav entry.
async function pendingCount() {
  try { const [r] = await sql<{ n: number }[]>`select count(*)::int n from items where status in ('queued','processing') and archived = false`; return r?.n ?? 0; } catch { return 0; }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pending = await pendingCount();
  return (
    <html lang="en" className={fraunces.variable}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 backdrop-blur border-b-2" style={{ borderColor: "var(--ink)", background: "color-mix(in srgb, var(--bg) 90%, transparent)" }}>
          <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <Link href="/" className="display text-xl sm:text-2xl font-bold italic" style={{ color: "var(--accent)", textDecoration: "underline wavy var(--accent-2)", textUnderlineOffset: 4 }}>Someday</Link>
            <nav className="flex gap-3 sm:gap-4 text-sm muted items-center">
              <span className="flex items-center gap-1"><Link href="/" className="hidden sm:inline">Saved</Link>{pending > 0 && <Link href="/?status=queued" className="rounded-full px-1.5 text-[10px] text-white" style={{ background: "var(--accent)" }} title={`${pending} still processing`}>{pending}</Link>}</span>
              <Link href="/collections">Shelves</Link>
              <Link href="/make">Projects</Link>
              <Link href="/add" className="chip on">Add</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>{children}</main>
      </body>
    </html>
  );
}
