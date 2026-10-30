import Link from "next/link";
import { sql, type Item } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { STAGES, type Stage } from "@/lib/stages";
import { setStage } from "./actions";

export const dynamic = "force-dynamic";

type Row = Item & { effective_stage: Stage };

export default async function MakeBoard() {
  await requireSession("/make");
  // Anything explicitly staged, plus AI "make" items that haven't been placed yet (they start in "want").
  const rows = await sql<Row[]>`
    select *, coalesce(stage, 'want') as effective_stage from items
    where archived = false and duplicate_of is null and (stage is not null or (stage is null and action = 'make'))
    order by stage_changed_at desc nulls last, created_at desc`;
  const by = (k: Stage) => rows.filter((r) => r.effective_stage === k);
  const m = (p?: string) => (p ? `/api/media/${p}` : null);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        <p className="text-xs muted">{rows.length} projects · anything you saved to make or cook lands in the first column; add others from their page.</p>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-4 lg:grid lg:grid-cols-4 lg:overflow-visible lg:mx-0 lg:px-0">
        {STAGES.map((s, i) => {
          const items = by(s.key);
          return (
            <section key={s.key} className="snap-start shrink-0 w-[82vw] sm:w-[360px] lg:w-auto rounded-2xl p-2 space-y-2" style={{ background: "var(--line)" }}>
              <header className="px-2 pt-1 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{s.label} <span className="muted font-normal">{items.length}</span></h2>
                <span className="text-[10px] muted">{s.hint}</span>
              </header>
              {items.length === 0 && <p className="card rounded-xl p-4 text-xs muted text-center">Nothing here yet</p>}
              {items.map((it) => (
                <article key={it.id} className="card rounded-xl overflow-hidden">
                  <Link href={`/item/${it.id}`} className="flex gap-2 p-2">
                    {m(it.media?.thumbnail) ? <img src={m(it.media.thumbnail)!} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" /> : <div className="w-16 h-16 rounded-lg shrink-0" style={{ background: "var(--line)" }} />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug line-clamp-2">{it.title ?? it.raw_text?.slice(0, 60) ?? "Saved item"}</div>
                      <div className="text-[11px] muted truncate">{[it.source, ...it.garments.slice(0, 2), ...it.fabrics.slice(0, 1)].join(" · ")}</div>
                      {it.stage_changed_at && <div className="text-[10px] muted">{s.key === "done" ? "finished" : "here since"} {new Date(it.stage_changed_at).toLocaleDateString()}</div>}
                    </div>
                  </Link>
                  <div className="flex border-t text-[11px]" style={{ borderColor: "var(--line)" }}>
                    {i > 0 && <MoveBtn id={it.id} stage={STAGES[i - 1].key} label={`← ${STAGES[i - 1].label}`} />}
                    {i < STAGES.length - 1 && <MoveBtn id={it.id} stage={STAGES[i + 1].key} label={`${STAGES[i + 1].label} →`} right />}
                    <MoveBtn id={it.id} stage="" label="×" title="Remove from board" compact />
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MoveBtn({ id, stage, label, right, compact, title }: { id: string; stage: string; label: string; right?: boolean; compact?: boolean; title?: string }) {
  return (
    <form action={setStage} className={compact ? "" : "flex-1"}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="stage" value={stage} />
      <button title={title} className={`w-full px-2 py-1.5 hover:underline ${right ? "text-right" : "text-left"} ${compact ? "muted px-3" : ""}`}>{label}</button>
    </form>
  );
}
