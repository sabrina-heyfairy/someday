import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { runAllSources } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 300;

// External cron hook: POST /api/sync?token=...  (the in-app scheduler calls the same function)
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await runAllSources() });
}
