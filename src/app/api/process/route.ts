import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { processQueued } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron-friendly: POST /api/process?token=... processes a few queued items.
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 3);
  const done = await processQueued(limit);
  return NextResponse.json({ processed: done });
}
