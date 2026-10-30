import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { redditConfigured, type Source } from "@/lib/sources";
import { addPinterestBoard, removeSource, syncNow, toggleSource } from "./actions";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession("/sources");
  const sp = await searchParams;
  const sources = await sql<Source[]>`select * from sources order by created_at`;
  const hours = Number(process.env.SYNC_INTERVAL_HOURS ?? 24);
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">Sources</h1>
        <p className="text-xs muted">Things Someday pulls on its own, every {hours} hours while the app is running. New finds are queued and tagged like any other save. Instagram, TikTok and Facebook have no safe automatic path; use the Shortcut day to day and the importer for backlogs.</p>
        {sp.connected && <p className="text-sm mt-2" style={{ color: "var(--accent)" }}>Reddit connected as u/{sp.connected}.</p>}
        {sp.error && <p className="text-sm mt-2" style={{ color: "var(--accent)" }}>Reddit: {sp.error}</p>}
      </div>

      <section className="card rounded-2xl p-4 space-y-3">
        <h2 className="font-medium">Pinterest boards</h2>
        <form action={addPinterestBoard} className="flex gap-2">
          <input name="url" placeholder="https://www.pinterest.com/you/board-name/" className="card flex-1 rounded-xl px-3 py-1.5 text-sm" required />
          <button className="chip on">Add board</button>
        </form>
        <p className="text-xs muted">Public boards only (Pinterest publishes an RSS feed for them). Each board becomes a collection.</p>
      </section>

      <section className="card rounded-2xl p-4 space-y-2">
        <h2 className="font-medium">Reddit saved posts</h2>
        {sources.some((s) => s.kind === "reddit_saved") ? <p className="text-sm muted">Connected. Saved posts and comments sync on the schedule.</p> :
          redditConfigured() ? <a href="/api/reddit/connect" className="chip on inline-block">Connect Reddit</a> :
          <p className="text-xs muted">Not configured. Create a Reddit app at reddit.com/prefs/apps (type <b>web app</b>, redirect URI <code>{process.env.APP_URL ?? "https://YOUR-APP"}/api/reddit/callback</code>), then set <code>REDDIT_CLIENT_ID</code>, <code>REDDIT_CLIENT_SECRET</code> and <code>APP_URL</code> and redeploy.</p>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Configured</h2>
          {sources.length > 0 && <form action={syncNow}><button className="chip">Sync all now</button></form>}
        </div>
        {sources.length === 0 && <p className="card rounded-2xl p-6 text-center text-sm muted">Nothing yet.</p>}
        {sources.map((s) => (
          <div key={s.id} className="card rounded-2xl p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-lg">{s.kind === "pinterest_board" ? "📌" : "👽"}</span>
            <div className="flex-1 min-w-[12rem]">
              <div className="font-medium">{s.label}{!s.enabled && <span className="muted font-normal"> · paused</span>}</div>
              <div className="text-xs muted">{s.last_run_at ? `${new Date(s.last_run_at).toLocaleString()} · ${s.last_message}` : "never run"}{s.last_status === "error" && " ⚠️"}</div>
            </div>
            <form action={syncNow}><input type="hidden" name="id" value={s.id} /><button className="chip">Sync now</button></form>
            <form action={toggleSource}><input type="hidden" name="id" value={s.id} /><button className="chip">{s.enabled ? "Pause" : "Resume"}</button></form>
            <form action={removeSource}><input type="hidden" name="id" value={s.id} /><button className="chip muted">Remove</button></form>
          </div>
        ))}
      </section>
    </div>
  );
}
