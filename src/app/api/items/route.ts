import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { searchItems } from "@/lib/search";

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const items = await searchItems({ q: p.get("q") ?? undefined, category: p.get("category") ?? undefined, source: p.get("source") ?? undefined, tag: p.get("tag") ?? undefined, limit: Number(p.get("limit") ?? 60) });
  return NextResponse.json({ items });
}
