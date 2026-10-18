"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { EventPlan, TextMessage } from "@/lib/types";
import { applyReply, decisionText, planContext, refNum, untexted } from "@/lib/decisions";
import { appendAudit } from "@/lib/autopilot";
import { usePhoton, type Live } from "@/lib/usePhotonSync";

function add(p: EventPlan, m: Omit<TextMessage, "id" | "ts" | "via">): EventPlan {
  const a = p.autopilot!;
  const texts = a.texts ?? [];
  return { ...p, autopilot: { ...a, texts: [...texts, { ...m, via: "simulated", id: `${m.dir === "out" ? "o" : "i"}${texts.length}`, ts: Date.now() }] } };
}

function audit(p: EventPlan, actor: string, action: string, detail: string): EventPlan {
  return { ...p, autopilot: { ...p.autopilot!, audit: appendAudit(p.autopilot!.audit, actor, action, detail) } };
}

/** Applies a command reply; anything that isn't a command comes back as a question for the agent to answer. */
function receive(p: EventPlan, text: string): { plan: EventPlan; question?: string; fallback?: string } {
  const withIn = add(p, { dir: "in", body: text });
  const r = applyReply(withIn, text, "simulated");
  if (r.unknown) return { plan: audit(withIn, "organizer", "text_question", `simulated: "${text.slice(0, 80)}"`), question: text, fallback: r.reply };
  const ap = r.plan.autopilot!;
  const asked = ap.purchases.filter((x) => x.status === "pending" && r.reply.includes(`#${refNum(x)} `)).map((x) => x.id);
  const next = asked.length ? { ...r.plan, autopilot: { ...ap, texted: [...new Set([...(ap.texted ?? []), ...asked])] } } : r.plan;
  return { plan: add(next, { dir: "out", body: r.reply }) };
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

function Thread({ texts, typing, empty }: { texts: TextMessage[]; typing?: string | null; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.parentElement?.scrollTo({ top: end.current.parentElement.scrollHeight });
  }, [texts.length, typing]);
  return (
    <div className="scrollbar-thin mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-xl bg-surface p-3" aria-live="polite">
      {texts.length === 0 && <p className="text-xs text-subtle">{empty}</p>}
      {texts.map((t) => (
        <div key={t.id} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed ${t.dir === "out" ? "self-start rounded-bl-sm border border-line bg-background text-foreground" : "self-end rounded-br-sm bg-accent text-white"}`}>
          {t.body}
        </div>
      ))}
      {typing && <div className="self-start rounded-2xl rounded-bl-sm border border-line bg-background px-3 py-2 text-xs text-muted">{typing}…</div>}
      <div ref={end} />
    </div>
  );
}

function Header({ live }: { live: Live | null }) {
  const on = !!live?.configured;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><MessageCircle size={14} className="text-accent" /> Organizer texts</h3>
      <span className={`rounded-lg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${on ? "bg-accent-soft text-accent" : "bg-surface text-muted"}`}>{on ? `Photon · ${live?.platform}` : "Simulated"}</span>
      {on && live?.linked && !live.error && <span className="flex items-center gap-1 text-[11px] text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" /> live</span>}
    </div>
  );
}

/** Autopilot texts the organizer when a decision needs them: the server-side Photon agent when configured, otherwise a simulated in-app thread. */
export function OrganizerTexts(props: { plan: EventPlan; onChange: (p: EventPlan) => void; running: boolean }) {
  const { live, thread } = usePhoton();
  if (live?.configured) {
    return (
      <section className="rounded-2xl border border-line p-5">
        <Header live={live} />
        <p className="mt-1 text-xs leading-[18px] text-muted">
          {live.error
            ? `Photon: ${live.error}. Decisions still work with the buttons above.`
            : live.linked
              ? `EventPilot is live on iMessage at ${live.agent}, even with this page closed. From ${live.organizer}, text YES 2, PICK CATERING 3, RUN, NEGOTIATE, THIS WEEK, STATUS, PLAN <new event>, or ask anything.`
              : `Text "hi" to ${live.agent} from ${live.organizer} once so EventPilot can reach you.`}
        </p>
        <Thread texts={thread} typing={live.working ? `EventPilot: ${live.working.toLowerCase()}` : null} empty="No texts yet. Pending decisions are texted to your phone a few seconds after Autopilot runs." />
      </section>
    );
  }
  return <Simulated {...props} live={live} />;
}

function Simulated({ plan, onChange, running, live }: { plan: EventPlan; onChange: (p: EventPlan) => void; running: boolean; live: Live | null }) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const planRef = useRef(plan);
  const changeRef = useRef(onChange);
  useEffect(() => {
    planRef.current = plan;
    changeRef.current = onChange;
  }, [plan, onChange]);
  const commit = useCallback((p: EventPlan) => {
    planRef.current = p;
    changeRef.current(p);
  }, []);

  useEffect(() => {
    if (!live || running || !plan.autopilot) return;
    const items = untexted(plan);
    if (!items.length) return;
    const a = plan.autopilot;
    commit(add({ ...plan, autopilot: { ...a, texted: [...(a.texted ?? []), ...items.map((x) => x.id)] } }, { dir: "out", body: decisionText(plan, items) }));
  }, [plan, running, live, commit]);

  const reply = async (text: string) => {
    if (!text.trim() || running || thinking) return;
    setDraft("");
    const r = receive(planRef.current, text.trim());
    commit(r.plan);
    if (!r.question) return;
    setThinking(true);
    const ans = await ask(planRef.current, r.question);
    setThinking(false);
    const cur = audit(planRef.current, "agent", "text_answer", ans ? `answered: "${ans.slice(0, 80)}"` : "no model; sent command help");
    commit(add(cur, { dir: "out", body: ans ?? r.fallback! }));
  };
  const pending = plan.autopilot?.purchases.filter((p) => p.status === "pending") ?? [];
  const chips = [...pending.slice(0, 2).map((p) => `YES ${refNum(p)}`), ...(pending.length > 1 ? ["ALL YES"] : []), "STATUS", "What's the biggest risk?"];

  return (
    <section className="rounded-2xl border border-line p-5">
      <Header live={live} />
      <p className="mt-1 text-xs leading-[18px] text-muted">
        {live === null ? "Checking messaging…" : "When a purchase needs you, EventPilot texts the organizer and acts on the reply. Simulated here; add Photon keys to text your phone."}
      </p>
      <Thread texts={plan.autopilot?.texts ?? []} typing={thinking ? "EventPilot is typing" : null} empty="No texts yet. Anything over your approval line will show up here as a text." />
      {live && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c} disabled={running || thinking} onClick={() => void reply(c)} className="rounded-full border border-line bg-background px-2.5 py-1 font-mono text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40">
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
