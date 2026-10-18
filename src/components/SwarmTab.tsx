"use client";
import { CheckCircle2, CircleAlert, CircleSlash, ShieldCheck } from "lucide-react";
import type { EventPlan } from "@/lib/types";
import { AGENTS } from "@/lib/types";
import { buildSwarm, RACI, SWARM_NAME } from "@/lib/swarm";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const VERDICT: Record<string, string> = { approve: "bg-success-soft text-success", escalate: "bg-warning-soft text-warning", send_back: "bg-danger-soft text-danger" };

export function SwarmTab({ plan }: { plan: EventPlan }) {
  const s = buildSwarm(plan);
  const on = s.categories.filter((c) => c.applies);
  const off = s.categories.filter((c) => !c.applies);
  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-wrap:anywhere]">
      <div className={`flex items-start gap-3 rounded-2xl border p-4 ${s.approved ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft"}`}>
        <ShieldCheck size={18} className={`mt-0.5 shrink-0 ${s.approved ? "text-success" : "text-warning"}`} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{SWARM_NAME} v{s.version}</div>
          <div className="text-sm text-muted">{s.approval}</div>
        </div>
      </div>

      <section>
        <h3 className="section-head">Agents on this event</h3>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {[{ name: "Exec", owns: "Scope, priorities, over-budget and >5% variance sign-off", agent: "exec" as const }, { name: "Logistics lead", owns: "Decides what's needed, assigns and reconciles category agents", agent: "lead" as const }, { name: "Finance", owns: `Budget owner and cost veto · envelope ${money(s.scope.envelope)} + ${money(s.scope.contingency)} contingency (${s.scope.contingencyPct}%)`, agent: "finance" as const }].map((x) => (
            <div key={x.name} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGENTS[x.agent].color }} />{x.name}</div>
              <div className="mt-1 text-xs text-muted">{x.owns}</div>
            </div>
          ))}
          {on.map((c) => (
            <div key={c.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGENTS[c.agent].color }} />{c.name}</div>
              <div className="mt-1 text-xs text-muted">{c.owns}</div>
              <div className="mt-1 text-xs text-subtle">{c.why}{c.line ? ` · ${money(c.line)} budget line` : ""}</div>
            </div>
          ))}
        </div>
        {off.length > 0 && <p className="mt-2 text-xs text-subtle">Not needed here: {off.map((c) => `${c.name} (${c.why.toLowerCase()})`).join(", ")}.</p>}
      </section>

      <section>
        <h3 className="section-head">Finance gate</h3>
        {s.finance.map((f) => (
          <div key={f.category} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 text-sm">
            <span className="min-w-0 flex-1 text-foreground">{f.category}</span>
            <span className="font-mono text-xs text-muted">{money(f.estimate)} / {money(f.line)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT[f.verdict]}`}>{f.verdict === "send_back" ? "Sent back" : f.verdict === "escalate" ? "To Exec" : "Approved"}</span>
            <span className="w-full text-xs text-subtle">{f.reason}</span>
          </div>
        ))}
      </section>

      {s.memos.length > 0 && (
        <section>
          <h3 className="section-head">Exec decision memos</h3>
          {s.memos.map((m) => (
            <div key={m.id} className="border-b border-line py-2.5 text-sm">
              <div className="font-medium text-foreground">{m.topic}</div>
              <div className="mt-1 text-xs text-muted">Options: {m.options.join(" · ")}</div>
              <div className="mt-1 text-xs text-foreground">Decision: {m.decision}</div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3 className="section-head">Verifier</h3>
        {s.verification.map((v) => (
          <div key={v.check} className="flex items-start gap-2 border-b border-line py-2 text-sm">
            {v.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" /> : v.blocker ? <CircleSlash size={15} className="mt-0.5 shrink-0 text-danger" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-warning" />}
            <span className="min-w-0 flex-1 text-foreground">{v.check}</span>
            <span className="max-w-[50%] text-right text-xs text-muted">{v.detail}</span>
          </div>
        ))}
      </section>

      <section>
        <h3 className="section-head">Who decides what</h3>
        {RACI.map((r) => (
          <div key={r.role} className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-line py-2.5 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
            <span className="font-medium text-foreground">{r.role}</span>
            <span className="text-muted">{r.decides}</span>
          </div>
        ))}
      </section>

      {s.thisWeek.length > 0 && (
        <section>
          <h3 className="section-head">This week</h3>
          <ul className="flex flex-col gap-1.5 text-sm text-foreground">{s.thisWeek.map((w) => <li key={w}>• {w}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
