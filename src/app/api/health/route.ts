import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [r] = await sql<{ queued: number; failed: number }[]>`select count(*) filter (where status='queued')::int queued, count(*) filter (where status='failed')::int failed from items`;
    return NextResponse.json({ ok: true, queued: r.queued, failed: r.failed, mock_ai: process.env.MOCK_AI === "1" || !process.env.ANTHROPIC_API_KEY });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
