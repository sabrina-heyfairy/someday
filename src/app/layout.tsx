import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Someday",
  description: "Everything you saved, finally findable.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Someday", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-180.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#faf7f2" }, { media: "(prefers-color-scheme: dark)", color: "#171412" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 backdrop-blur border-b" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}>
          <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <Link href="/" className="font-semibold tracking-tight">Someday</Link>
            <nav className="flex gap-4 text-sm muted">
              <Link href="/?status=queued">Queue</Link>
              <Link href="/add">Add</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>{children}</main>
      </body>
    </html>
  );
}
