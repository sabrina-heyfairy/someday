"use client";
import { useState } from "react";
import type { Item } from "@/lib/db";
import { STAGES } from "@/lib/stages";
import { ItemCard } from "./item-card";
import { bulk } from "./bulk-actions";

type Coll = { id: string; name: string };

// Grid with a select mode. Tap "Select" in the toolbar, tick cards, pick an action in the bottom bar.
export function BulkGrid({ items, collections }: { items: Item[]; collections: Coll[] }) {
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const idsJson = JSON.stringify([...sel]);
  const done = () => { setSel(new Set()); setSelecting(false); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <button onClick={() => (selecting ? done() : setSelecting(true))} className={`chip ${selecting ? "on" : ""}`}>{selecting ? "Done" : "Select"}</button>
        {selecting && <>
          <button onClick={() => setSel(new Set(items.map((i) => i.id)))} className="chip">All {items.length}</button>
          <button onClick={() => setSel(new Set())} className="chip">None</button>
          <span className="muted">{sel.size} selected</span>
        </>}
      </div>

      <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3">
        {items.map((it) => (
          <div key={it.id} className="relative break-inside-avoid">
            {selecting && (
              <button onClick={() => toggle(it.id)} aria-label="select" className="absolute inset-0 z-10 rounded-2xl" style={{ outline: sel.has(it.id) ? "3px solid var(--accent)" : "none", background: sel.has(it.id) ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent" }}>
                <span className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: sel.has(it.id) ? "var(--accent)" : "var(--card)", color: sel.has(it.id) ? "white" : "transparent", border: "1px solid var(--line)" }}>✓</span>
              </button>
            )}
            <ItemCard item={it} />
          </div>
        ))}
      </div>

      {selecting && sel.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <div className="card mx-auto max-w-3xl rounded-2xl p-3 shadow-lg flex flex-wrap gap-2 items-center text-sm">
            <span className="font-medium mr-1">{sel.size} item{sel.size > 1 ? "s" : ""}</span>
            <form action={async (fd) => { await bulk(fd); done(); }} className="flex gap-1">
              <input type="hidden" name="ids" value={idsJson} /><input type="hidden" name="op" value="tag" />
              <input name="value" placeholder="add tags, comma separated" className="card rounded-full px-3 py-1 text-xs w-44" required />
              <button className="chip on">Tag</button>
            </form>
            <form action={async (fd) => { await bulk(fd); done(); }} className="flex gap-1">
              <input type="hidden" name="ids" value={idsJson} /><input type="hidden" name="op" value="collection" />
              <select name="value" className="card rounded-full px-2 py-1 text-xs"><option value="">shelf…</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input name="new_name" placeholder="or new shelf" className="card rounded-full px-3 py-1 text-xs w-24" />
              <button className="chip on">Add</button>
            </form>
            <form action={async (fd) => { await bulk(fd); done(); }} className="flex gap-1">
              <input type="hidden" name="ids" value={idsJson} /><input type="hidden" name="op" value="stage" />
              <select name="value" className="card rounded-full px-2 py-1 text-xs" required><option value="">projects…</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              <button className="chip on">Move</button>
            </form>
            <form action={async (fd) => { await bulk(fd); done(); }}><input type="hidden" name="ids" value={idsJson} /><input type="hidden" name="op" value="star" /><button className="chip">★ Star</button></form>
            <form action={async (fd) => { if (confirm(`Archive ${sel.size} item(s)? They leave the grid but are not deleted.`)) { await bulk(fd); done(); } }}><input type="hidden" name="ids" value={idsJson} /><input type="hidden" name="op" value="archive" /><button className="chip">Archive</button></form>
          </div>
        </div>
      )}
    </div>
  );
}
