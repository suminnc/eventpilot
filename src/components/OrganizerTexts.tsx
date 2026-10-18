"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { EventPlan, TextMessage } from "@/lib/types";
import { applyReply, decisionText, planContext, refNum, untexted } from "@/lib/decisions";
import { appendAudit } from "@/lib/autopilot";

type Live = { configured: boolean; platform?: string; agent?: string; organizer?: string; linked?: boolean; error?: string };
type Via = TextMessage["via"];

function add(p: EventPlan, m: Omit<TextMessage, "id" | "ts"> & { id?: string }): EventPlan {
  const a = p.autopilot!;
  const texts = a.texts ?? [];
  return { ...p, autopilot: { ...a, texts: [...texts, { ...m, id: m.id ?? `${m.dir === "out" ? "o" : "i"}${texts.length}`, ts: Date.now() }] } };
}

function audit(p: EventPlan, actor: string, action: string, detail: string): EventPlan {
  return { ...p, autopilot: { ...p.autopilot!, audit: appendAudit(p.autopilot!.audit, actor, action, detail) } };
}

/** Applies a command reply; anything that isn't a command comes back as a question for the agent to answer. */
function receive(p: EventPlan, text: string, via: Via, id?: string): { plan: EventPlan; question?: string; fallback?: string } {
  const withIn = add(p, { id, dir: "in", body: text, via });
  const r = applyReply(withIn, text, via === "photon" ? "iMessage" : "simulated");
  if (r.unknown) return { plan: audit(withIn, "organizer", "text_question", `${via === "photon" ? "iMessage" : "simulated"}: "${text.slice(0, 80)}"`), question: text, fallback: r.reply };
  const ap = r.plan.autopilot!;
  const asked = ap.purchases.filter((x) => x.status === "pending" && r.reply.includes(`#${refNum(x)} `)).map((x) => x.id);
  const next = asked.length ? { ...r.plan, autopilot: { ...ap, texted: [...new Set([...(ap.texted ?? []), ...asked])] } } : r.plan;
  return { plan: add(next, { dir: "out", body: r.reply, via, queued: via === "photon" || undefined }) };
}

async function ask(p: EventPlan, question: string): Promise<string | null> {
  try {
    const history = (p.autopilot?.texts ?? []).slice(-7, -1).map(({ dir, body }) => ({ dir, body }));
    const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, context: planContext(p), history }) });
    const j = (await r.json()) as { reply?: string | null };
    return r.ok && j.reply ? j.reply : null;
  } catch {
    return null;
  }
}

/** Autopilot texts the organizer when a decision needs them (Photon iMessage/SMS when configured, otherwise a simulated thread). */
export function OrganizerTexts({ plan, onChange, running }: { plan: EventPlan; onChange: (p: EventPlan) => void; running: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const planRef = useRef(plan);
  const changeRef = useRef(onChange);
  const runningRef = useRef(running);
  const flushing = useRef(false);
  const polling = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    planRef.current = plan;
    changeRef.current = onChange;
    runningRef.current = running;
  }, [plan, onChange, running]);

  const texts = plan.autopilot?.texts ?? [];
  const via: Via = live?.configured ? "photon" : "simulated";
  const commit = useCallback((p: EventPlan) => {
    planRef.current = p;
    changeRef.current(p);
  }, []);

  const answer = useCallback(
    async (question: string, fallback: string, via: Via) => {
      setThinking(true);
      const reply = await ask(planRef.current, question);
      setThinking(false);
      const cur = planRef.current;
      const logged = audit(cur, "agent", "text_answer", reply ? `answered: "${reply.slice(0, 80)}"` : "no model; sent command help");
      commit(add(logged, { dir: "out", body: reply ?? fallback, via, queued: via === "photon" || undefined }));
    },
    [commit],
  );

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (;;) {
        const p = planRef.current;
        const q = p.autopilot?.texts?.find((t) => t.queued);
        if (!q) break;
        const r = await fetch("/api/photon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: q.body, key: `ep-${p.id.slice(0, 8)}-${q.id}-${q.ts}` }) });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setLive((l) => l && (r.status === 409 ? { ...l, linked: false, error: undefined } : { ...l, error: j.error ?? `HTTP ${r.status}` }));
          break;
        }
        const cur = planRef.current;
        commit({ ...cur, autopilot: { ...cur.autopilot!, texts: (cur.autopilot!.texts ?? []).map((t) => (t.id === q.id ? { ...t, queued: undefined } : t)) } });
        setLive((l) => l && { ...l, linked: true, error: undefined });
      }
    } catch {
      setLive((l) => l && { ...l, error: "Couldn't reach the server" });
    } finally {
      flushing.current = false;
    }
  }, [commit]);

  useEffect(() => {
    fetch("/api/photon")
      .then((r) => r.json())
      .then((j: Live) => setLive(j))
      .catch(() => setLive({ configured: false }));
  }, []);

  useEffect(() => {
    if (!live || running || !plan.autopilot) return;
    const items = untexted(plan);
    if (!items.length) return;
    const a = plan.autopilot;
    const p = add({ ...plan, autopilot: { ...a, texted: [...(a.texted ?? []), ...items.map((x) => x.id)] } }, { dir: "out", body: decisionText(plan, items), via, queued: via === "photon" || undefined });
    commit(p);
    if (via === "photon") void flush();
  }, [plan, running, live, via, commit, flush]);

  useEffect(() => {
    if (!live?.configured) return;
    const tick = async () => {
      if (polling.current || runningRef.current) return;
      polling.current = true;
      try {
        const start = planRef.current.autopilot?.texts?.[0]?.ts;
        const r = await fetch(`/api/photon${start ? `?since=${start}` : ""}`);
        const j = (await r.json()) as Live & { messages?: { id: string; text: string }[] };
        setLive((l) => ({ ...l, ...j, error: r.ok ? undefined : j.error }));
        let p = planRef.current;
        const seen = new Set((p.autopilot?.texts ?? []).map((t) => t.id));
        const fresh = (j.messages ?? []).filter((m) => !seen.has(m.id));
        if (!p.autopilot || !start) return;
        for (const m of fresh) {
          const r = receive(p, m.text, "photon", m.id);
          commit(r.plan);
          if (r.question) await answer(r.question, r.fallback!, "photon");
          p = planRef.current;
        }
        if (fresh.length || j.linked) await flush();
      } catch {
        setLive((l) => l && { ...l, error: "Couldn't reach the server" });
      } finally {
        polling.current = false;
      }
    };
    const id = setInterval(tick, 4000);
    void tick();
    return () => clearInterval(id);
  }, [live?.configured, commit, flush, answer]);

  useEffect(() => {
    end.current?.parentElement?.scrollTo({ top: end.current.parentElement.scrollHeight });
  }, [texts.length, thinking]);

  const reply = async (text: string) => {
    if (!text.trim() || running || thinking) return;
    setDraft("");
    const r = receive(planRef.current, text.trim(), "simulated");
    commit(r.plan);
    if (r.question) await answer(r.question, r.fallback!, "simulated");
  };
  const pending = plan.autopilot?.purchases.filter((p) => p.status === "pending") ?? [];
  const chips = [...pending.slice(0, 2).map((p) => `YES ${refNum(p)}`), ...(pending.length > 1 ? ["ALL YES"] : []), "STATUS", "What's the biggest risk?"];

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white/80"><MessageCircle size={14} className="text-accent" /> Organizer texts</h3>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${via === "photon" ? "bg-accent/15 text-accent-soft" : "bg-white/10 text-white/50"}`}>
          {via === "photon" ? `Photon · ${live?.platform}` : "Simulated"}
        </span>
      </div>
      <p className="mt-1 text-xs text-white/50">
        {live === null
          ? "Checking messaging…"
          : !live.configured
            ? "When a purchase needs you, EventPilot texts the organizer and acts on the reply. Simulated here; add Photon keys to text your phone."
            : live.error
              ? `Photon error: ${live.error}. Decisions still work with the buttons above.`
              : live.linked
                ? `Decisions are texted to ${live.organizer} through Photon. Reply from your phone.`
                : `Text "hi" to ${live.agent} from ${live.organizer} once so EventPilot can reach you.`}
      </p>
      <div className="scrollbar-thin mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg bg-black/30 p-3" aria-live="polite">
        {texts.length === 0 && <p className="text-xs text-white/35">No texts yet. Anything over your approval line will show up here as a text.</p>}
        {texts.map((t) => (
          <div key={t.id} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed ${t.dir === "out" ? "self-start rounded-bl-sm bg-white/[0.07] text-white/85" : "self-end rounded-br-sm bg-accent text-black"}`}>
            {t.body}
            {t.queued && <div className="mt-1 text-[10px] text-white/40">Waiting to send…</div>}
          </div>
        ))}
        {thinking && <div className="self-start rounded-2xl rounded-bl-sm bg-white/[0.07] px-3 py-2 text-xs text-white/50">EventPilot is typing…</div>}
        <div ref={end} />
      </div>
      {live && !live.configured && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c} disabled={running || thinking} onClick={() => void reply(c)} className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[11px] text-white/70 hover:border-accent/50 hover:text-white disabled:opacity-40">
                {c}
              </button>
            ))}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void reply(draft); }}>
            <input className="input min-w-0 flex-1 text-sm" placeholder="Reply or ask anything, e.g. PICK CATERING 2" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={running} aria-label="Reply as the organizer" />
            <button className="btn-primary px-3" disabled={running || thinking || !draft.trim()} aria-label="Send reply"><Send size={14} /></button>
          </form>
        </>
      )}
    </section>
  );
}
