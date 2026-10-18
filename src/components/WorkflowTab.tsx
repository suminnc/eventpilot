"use client";
import { CalendarClock, Users } from "lucide-react";
import type { EventPlan } from "@/lib/types";
import { buildWorkflow, type GateStatus } from "@/lib/workflow";

const PILL: Record<GateStatus, string> = {
  done: "bg-success-soft text-success",
  overdue: "bg-danger-soft text-danger",
  past: "bg-danger-soft text-danger",
  this_week: "bg-warning-soft text-warning",
  upcoming: "bg-surface text-muted",
};
const LABEL: Record<GateStatus, string> = { done: "done", overdue: "late · catch-up", past: "missed", this_week: "this week", upcoming: "upcoming" };

/** Organizing workflow based on the Cal Hacks operations playbook, scaled to this event. */
export function WorkflowTab({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const w = buildWorkflow(plan);
  const done = new Set(plan.workflowDone ?? []);
  const toggle = (id: string) => onChange({ ...plan, workflowDone: done.has(id) ? [...done].filter((x) => x !== id) : [...done, id] });
  const scaleLabel = { large: "Large event: full team structure", medium: "Mid-size event: core team", small: "Small event: a few roles", intimate: "Intimate event: host + helper" }[w.scale];
  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-wrap:anywhere]">
      <p className="rounded-xl bg-surface p-3 text-xs leading-[18px] text-muted">
        Modeled on the Cal Hacks operations playbook and scaled to {plan.brief.guests.toLocaleString()} guests. {scaleLabel}.{" "}
        {w.daysOut > 0 ? `${w.daysOut} days out.` : "Event date has passed."}
        {w.compressed > 0 && ` ${w.compressed} milestone${w.compressed > 1 ? "s were" : " was"} already past its normal date, so ${w.compressed > 1 ? "they're" : "it's"} rescheduled into a catch-up plan before the event.`}
      </p>

      <section>
        <h3 className="section-head"><Users size={14} /> Teams</h3>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 sm:grid-cols-2">
          {w.teams.map((t) => (
            <div key={t.name} className="border-b border-line py-3 text-sm">
              <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-foreground">{t.name}</span><span className="shrink-0 font-mono text-xs text-subtle">{t.size} {t.size === "1" ? "person" : "people"}</span></div>
              <div className="text-muted">{t.owns}</div>
              <div className="text-xs text-subtle">Owns: {t.output}</div>
              {t.subteams?.length ? <div className="text-xs text-subtle">Distributes to {t.subteams.join(" · ")}</div> : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="section-head"><CalendarClock size={14} /> Countdown</h3>
        {w.gates.map((g) => (
          <label key={g.id} className="flex cursor-pointer items-start gap-3 border-b border-line px-1 py-3 text-sm hover:bg-surface/60">
            <input type="checkbox" checked={g.status === "done"} onChange={() => toggle(g.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#4f6146]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${g.status === "done" ? "text-subtle line-through" : "text-foreground"}`}>{g.title}</span>
                <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${PILL[g.status]}`}>{LABEL[g.status]}</span>
              </div>
              <div className="mt-0.5 text-xs leading-[18px] text-muted">{g.detail}</div>
            </div>
            <div className="shrink-0 text-right text-xs">
              <div className="font-mono text-foreground">{g.due}</div>
              <div className="text-subtle">{g.tMinus > 0 ? `T-${g.tMinus}d` : g.tMinus === 0 ? "T-0" : `T+${-g.tMinus}d`} · {g.owner}</div>
              {g.due !== g.originalDue && <div className="text-subtle line-through">{g.originalDue}</div>}
            </div>
          </label>
        ))}
      </section>

      <section>
        <h3 className="section-head">Control loop</h3>
        <ol className="pt-2 text-sm text-muted">
          {w.phases.map((p) => (
            <li key={p.id} className="border-b border-line py-2">
              <span className="font-medium text-foreground">{p.title}</span>
              <span className="text-subtle"> · {p.owner}</span>
              <div className="text-xs leading-[18px]">{p.does}</div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="section-head">Who checks what</h3>
        {w.checks.map((c) => (
          <div key={c.handoff} className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-line py-3 text-sm sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4">
            <div><div className="font-medium text-foreground">{c.handoff}</div><div className="text-xs text-subtle">Checked by {c.checker}</div></div>
            <div className="text-muted">{c.check}</div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="section-head">Guardrails</h3>
        <ul className="pt-2 text-sm text-muted">{w.guardrails.map((g) => <li key={g} className="border-b border-line py-2">{g}</li>)}</ul>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-2">
        <section>
          <h3 className="section-head">Meeting cadence</h3>
          <ul className="pt-2 text-sm text-muted">{w.cadence.map((c) => <li key={c} className="border-b border-line py-2">{c}</li>)}</ul>
        </section>
        <section>
          <h3 className="section-head">Shared trackers</h3>
          <ul className="pt-2 text-sm text-muted">{w.trackers.map((c) => <li key={c} className="border-b border-line py-2">{c}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
