"use client";
import { useEffect, useState } from "react";
import { Bot, CalendarClock, Users } from "lucide-react";
import type { EventPlan, Task } from "@/lib/types";
import { AGENTS } from "@/lib/types";
import { buildWorkflow, type Gate, type GateStatus } from "@/lib/workflow";
import { defaultMandate } from "@/lib/autopilot";
import { runAutopilot } from "./AutopilotPanel";

const PILL: Record<GateStatus, string> = {
  done: "bg-success-soft text-success",
  active: "bg-accent-soft text-accent",
  overdue: "bg-danger-soft text-danger",
  past: "bg-danger-soft text-danger",
  this_week: "bg-warning-soft text-warning",
  upcoming: "bg-surface text-muted",
};
const LABEL: Record<GateStatus, string> = { done: "done", active: "Autopilot on it", overdue: "late · catch-up", past: "missed", this_week: "this week", upcoming: "upcoming" };

/** One checklist: playbook milestones (T-minus gates) with the concrete tasks due before each, checked off by Autopilot as it works. */
export function ActionPlanTab({ plan, onChange, children }: { plan: EventPlan; onChange: (p: EventPlan) => void; children?: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const [mailLive, setMailLive] = useState(false);
  useEffect(() => {
    fetch("/api/email").then((r) => r.json()).then((j) => setMailLive(!!j.live)).catch(() => {});
  }, []);
  const w = buildWorkflow(plan);
  const manual = new Set(plan.workflowDone ?? []);
  const toggleGate = (g: Gate) => onChange({ ...plan, workflowDone: manual.has(g.id) ? [...manual].filter((x) => x !== g.id) : [...manual, g.id] });
  const toggleTask = (t: Task) => onChange({ ...plan, tasks: plan.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) });
  const drafted = new Set((plan.autopilot?.outbox ?? []).filter((m) => m.status === "draft" && m.taskId).map((m) => m.taskId!));

  const sorted = [...plan.tasks].sort((a, b) => a.due.localeCompare(b.due));
  const groups = new Map<string, Task[]>(w.gates.map((g) => [g.id, []]));
  for (const t of sorted) {
    const g = w.gates.find((x) => x.tMinus >= 0 && x.due >= t.due) ?? w.gates.filter((x) => x.tMinus >= 0).at(-1) ?? w.gates[0];
    if (g) groups.get(g.id)!.push(t);
  }
  const total = w.gates.length + plan.tasks.length;
  const doneCount = w.gates.filter((g) => g.status === "done").length + plan.tasks.filter((t) => t.done).length;
  const pct = Math.round((100 * doneCount) / Math.max(1, total));
  const pending = plan.autopilot?.purchases.filter((p) => p.status === "pending").length ?? 0;
  const late = w.gates.filter((g) => g.status === "past" || g.status === "overdue").length;
  const scaleLabel = { large: "full team structure", medium: "core team", small: "a few roles", intimate: "host + helper" }[w.scale];

  const run = async () => {
    setRunning(true);
    await runAutopilot(plan, plan.autopilot?.mandate ?? defaultMandate(plan), mailLive, onChange, setStep);
    setStep("");
    setRunning(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-wrap:anywhere]">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-2xl border border-line p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <div>
          <div className="section-head mb-1">Readiness</div>
          <div className="font-display text-5xl text-foreground">{pct}<span className="text-xl text-subtle">%</span></div>
        </div>
        <div className="min-w-0 text-sm text-muted">
          <div className="mb-2 h-1 overflow-hidden bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
          {doneCount}/{total} steps done · {w.daysOut > 0 ? `${w.daysOut} days out` : "event date has passed"}
          {late > 0 && ` · ${late} milestone${late > 1 ? "s" : ""} late, rescheduled into a catch-up plan`}
          {pending > 0 && <span className="text-warning"> · {pending} payment{pending > 1 ? "s" : ""} need your OK on Autopilot</span>}
          {running && step && <div className="mt-1 truncate font-mono text-xs text-accent">{step}</div>}
        </div>
        <button disabled={running} onClick={run} className="btn bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60">
          <Bot size={15} /> {running ? "Working…" : plan.autopilot ? "Run Autopilot again" : "Run Autopilot"}
        </button>
      </div>

      <section>
        <h3 className="section-head"><CalendarClock size={14} /> Every step to event day</h3>
        <p className="mb-2 text-xs leading-[18px] text-muted">Milestones from the Cal Hacks operations playbook, scaled to {plan.brief.guests.toLocaleString()} guests ({scaleLabel}), with the tasks due before each one. Autopilot checks steps off as it emails vendors, closes deals, pays deposits and files permits.</p>
        {w.gates.map((g) => (
          <div key={g.id} className="border-b border-line">
            <label className="flex cursor-pointer items-start gap-3 px-1 py-3 text-sm hover:bg-surface/60">
              <input type="checkbox" checked={g.status === "done"} disabled={g.status === "done" && !manual.has(g.id)} title={g.status === "done" && !manual.has(g.id) ? "Checked off by Autopilot" : undefined} onChange={() => toggleGate(g)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#4f6146]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${g.status === "done" ? "text-subtle line-through" : "text-foreground"}`}>{g.title}</span>
                  <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${PILL[g.status]}`}>{LABEL[g.status]}</span>
                  {g.auto && g.status === "done" && <span className="flex items-center gap-1 text-[11px] text-accent"><Bot size={11} /> Autopilot</span>}
                </div>
                <div className="mt-0.5 text-xs leading-[18px] text-muted">{g.detail}</div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="font-mono text-foreground">{g.due}</div>
                <div className="text-subtle">{g.tMinus > 0 ? `T-${g.tMinus}d` : g.tMinus === 0 ? "T-0" : `T+${-g.tMinus}d`} · {g.owner}</div>
                {g.due !== g.originalDue && <div className="text-subtle line-through">{g.originalDue}</div>}
              </div>
            </label>
            {groups.get(g.id)!.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-3 py-2 pl-8 pr-1 text-sm hover:bg-surface/60">
                <input type="checkbox" checked={t.done} onChange={() => toggleTask(t)} className="h-3.5 w-3.5 shrink-0 accent-[#4f6146]" />
                <span className={`min-w-0 flex-1 ${t.done ? "text-subtle line-through" : "text-foreground"}`}>{t.title}</span>
                {!t.done && drafted.has(t.id) && <span className="shrink-0 rounded-lg bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">drafted</span>}
                <span className="hidden text-xs text-muted sm:inline">{AGENTS[t.agent]?.name ?? t.owner}</span>
                <span className={`shrink-0 rounded-lg px-1.5 py-0.5 font-mono text-[11px] ${t.priority === "high" && !t.done ? "bg-danger-soft text-danger" : "bg-surface text-muted"}`}>{t.due}</span>
              </label>
            ))}
          </div>
        ))}
      </section>

      {children}

      <details className="group rounded-2xl border border-line p-5">
        <summary className="section-head cursor-pointer list-none"><Users size={14} /> Team structure, handoff checks and guardrails</summary>
        <div className="mt-4 flex flex-col gap-6">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 sm:grid-cols-2">
            {w.teams.map((t) => (
              <div key={t.name} className="border-b border-line py-3 text-sm">
                <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-foreground">{t.name}</span><span className="shrink-0 font-mono text-xs text-subtle">{t.size} {t.size === "1" ? "person" : "people"}</span></div>
                <div className="text-muted">{t.owns}</div>
                <div className="text-xs text-subtle">Owns: {t.output}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-subtle">Who checks what</div>
            {w.checks.map((c) => (
              <div key={c.handoff} className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-line py-2 text-sm sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4">
                <div><div className="font-medium text-foreground">{c.handoff}</div><div className="text-xs text-subtle">Checked by {c.checker}</div></div>
                <div className="text-muted">{c.check}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
            {([["Guardrails", w.guardrails], ["Meeting cadence", w.cadence], ["Shared trackers", w.trackers]] as const).map(([h, list]) => (
              <div key={h}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-subtle">{h}</div>
                <ul className="text-sm text-muted">{list.map((x) => <li key={x} className="border-b border-line py-1.5">{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
