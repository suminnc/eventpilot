"use client";
import { Check, Plus, TriangleAlert } from "lucide-react";
import type { EventPlan, Task } from "@/lib/types";
import { stakeholderViews } from "@/lib/stakeholders";

const LEVEL = { high: "bg-danger-soft text-danger", medium: "bg-warning-soft text-warning", low: "bg-surface text-muted" } as const;

/** The plan seen by the organizer, sponsor (if any), vendors and attendees. Issues can be turned into tasks. */
export function StakeholdersTab({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const views = stakeholderViews(plan);
  const titles = new Set(plan.tasks.map((t) => t.title));
  const addTask = (title: string, high: boolean) => {
    const due = new Date(Math.min(Date.now() + 3 * 864e5, Math.max(Date.now(), new Date(plan.brief.date).getTime() - 864e5))).toISOString().slice(0, 10);
    const task: Task = { id: `sh-${plan.tasks.length}-${Date.now().toString(36)}`, title, due, owner: "Organizer", priority: high ? "high" : "medium", done: false, agent: "verifier" };
    onChange({ ...plan, tasks: [...plan.tasks, task] });
  };
  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-wrap:anywhere]">
      <p className="rounded-xl bg-surface p-3 text-xs leading-[18px] text-muted">
        The same plan, reviewed by everyone it has to work for.{" "}
        {views.some((v) => v.persona === "Sponsor") ? "" : "No sponsors on this event, so there's no sponsor view. "}
        Add any issue to Tasks with one click.
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 lg:grid-cols-2">
        {views.map((v) => (
          <section key={v.persona} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
              <h3 className="text-base font-semibold text-foreground">{v.persona}</h3>
              <span className={`font-mono text-sm ${v.score >= 80 ? "text-success" : v.score >= 60 ? "text-warning" : "text-danger"}`}>{v.score}/100</span>
            </div>
            <p className="pt-2 text-xs text-subtle">Wants: {v.goal}</p>
            <ul className="pt-2 text-sm">
              {v.needs.map((n) => (
                <li key={n.label} className="flex items-start gap-2 py-1.5">
                  {n.ok ? <Check size={14} className="mt-0.5 shrink-0 text-success" /> : <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />}
                  <div className="min-w-0"><span className="font-medium text-foreground">{n.label}</span> <span className="text-muted">· {n.detail}</span></div>
                </li>
              ))}
            </ul>
            {v.issues.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-subtle">Would flag</div>
                {v.issues.map((i) => {
                  const title = `${v.persona}: ${i.fix}`;
                  const added = titles.has(title);
                  return (
                    <div key={i.issue} className="flex items-start gap-3 border-b border-line py-2.5 text-sm">
                      <span className={`mt-0.5 shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold uppercase ${LEVEL[i.level]}`}>{i.level}</span>
                      <div className="min-w-0 flex-1"><div className="text-foreground">{i.issue}</div><div className="text-xs text-muted">{i.fix}</div></div>
                      <button type="button" disabled={added} onClick={() => addTask(title, i.level === "high")} className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:bg-surface disabled:opacity-50" aria-label={`Add task: ${i.fix}`}>
                        {added ? "Added" : <span className="inline-flex items-center gap-1"><Plus size={12} />Task</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
