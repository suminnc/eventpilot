"use client";
import { useState } from "react";
import Image from "next/image";
import {
  FileCheck2,
  CalendarDays, Copy, Download, FileText, MapPin, MessageSquare, ShieldAlert, Users, Wallet, CloudSun, Clock, Star, Check,
} from "lucide-react";
import type { EventPlan } from "@/lib/types";
import { AGENTS } from "@/lib/types";
import { planToICS, planToMarkdown } from "@/lib/export";
import { AutopilotPanel } from "./AutopilotPanel";
import { reselectVenue } from "@/lib/replan";
import { WorkflowTab } from "./WorkflowTab";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const TABS = ["Overview", "Workflow", "Schedule", "Budget", "Venues", "Tasks", "Permits", "Ops", "Invite", "Autopilot"] as const;
type Tab = (typeof TABS)[number];
// Budget categories: sage, sky and earth tones that sit with the brand accent.
const COLORS = ["#4f6146", "#7e9a6e", "#a9bc97", "#4d6b7d", "#86a3b4", "#bccdd8", "#8c7a5b", "#b8a07a", "#5f6570", "#a3a8b0"];
const RISK: Record<string, string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warning-soft text-warning",
  low: "bg-success-soft text-success",
};

export function PlanView({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const b = plan.brief;
  const venue = plan.venues[plan.selectedVenue];
  const done = plan.tasks.filter((t) => t.done).length;
  const pending = plan.autopilot?.purchases.some((p) => p.status === "pending");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6 pb-6">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{b.eventType}</span>
            <span className={`rounded-lg border px-2 py-0.5 text-[11px] ${plan.mode === "llm" ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-surface text-muted"}`}>
              {plan.mode === "llm" ? plan.model : "offline planner"}
            </span>
          </div>
          <h2 className="font-display text-4xl leading-tight tracking-[-0.015em] sm:text-5xl sm:leading-[52px]">{b.title}</h2>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <button className="btn-ghost px-3.5" onClick={() => download(`${slug(b.title)}.ics`, planToICS(plan), "text/calendar")} title="Add event + prep tasks to calendar">
            <Download size={14} /> .ics
          </button>
          <button className="btn-ghost px-3.5" onClick={() => download(`${slug(b.title)}.md`, planToMarkdown(plan), "text/markdown")} title="Export plan as Markdown">
            <FileText size={14} /> .md
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-3.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-foreground">
          <span className="flex items-center gap-1.5"><CalendarDays size={15} className="text-muted" /> {fmtDate(b.date)} · {b.startTime}</span>
          <span className="flex items-center gap-1.5"><Clock size={15} className="text-muted" /> {b.durationHours}h</span>
          <span className="flex items-center gap-1.5"><Users size={15} className="text-muted" /> {b.guests.toLocaleString()} guests</span>
          <span className="flex items-center gap-1.5 font-mono"><Wallet size={15} className="text-muted" /> {money(b.budget)}</span>
          <span className="flex items-center gap-1.5"><MapPin size={15} className="text-muted" /> {venue?.name ?? b.city}</span>
        </div>
        <Score score={plan.score} />
      </div>

      <div className="mt-5 flex gap-6 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px flex shrink-0 items-center border-b-2 pb-3 text-sm transition ${tab === t ? "border-foreground font-semibold text-foreground" : "border-transparent font-medium text-muted hover:text-foreground"}`}
          >
            {t}
            {t === "Tasks" && <span className="ml-1.5 font-mono text-xs text-subtle">{done}/{plan.tasks.length}</span>}
            {t === "Permits" && (plan.permits?.length ?? 0) > 0 && <span className="ml-1.5 font-mono text-xs text-subtle">{plan.permits!.filter((p) => plan.tasks.find((x) => x.id === p.taskId)?.done).length}/{plan.permits!.length}</span>}
            {t === "Autopilot" && (
              <span className={`ml-1.5 rounded-lg px-1.5 py-px text-[11px] font-semibold ${pending ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent"}`}>
                {pending ? "approve" : "new"}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-7">
        {tab === "Overview" && (
          <div className="flex flex-col gap-8">
            <p className="border-l-2 border-foreground pl-4 text-[17px] leading-7 text-foreground">{plan.summary}</p>
            {venue && /pier 27/i.test(venue.name) && (
              <figure className="relative aspect-[21/9] overflow-hidden rounded-2xl bg-surface">
                <Image src="/images/venue-pier27.jpg" alt={`${venue.name} interior with bay views`} fill sizes="(min-width: 1024px) 800px, 100vw" className="object-cover" />
                <figcaption className="absolute bottom-3 left-3 rounded-lg bg-background/90 px-2 py-1 text-[11px] text-muted">Illustrative image</figcaption>
              </figure>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-2">
              <Stat icon={<MapPin size={14} />} label="Venue" value={venue?.name ?? "TBD"} sub={venue?.why} />
              <Stat
                icon={<CloudSun size={14} />}
                label="Weather"
                value={plan.weather?.summary ?? "—"}
                sub={plan.weather?.highC != null ? `High ${Math.round(plan.weather.highC)}°C / ${Math.round((plan.weather.highC * 9) / 5 + 32)}°F · ${plan.weather.precipChance ?? "?"}% precip · ${plan.weather.source}` : undefined}
              />
            </div>
            <div>
              <h3 className="section-head"><ShieldAlert size={15} /> Critic review</h3>
              {plan.risks.map((r, i) => (
                <div key={i} className="flex gap-4 border-b border-line py-3.5">
                  <div className="w-[72px] shrink-0 pt-0.5">
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${RISK[r.level]}`}>{r.level}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="text-[15px] font-medium leading-[22px] text-foreground">{r.issue}</div>
                    <div className="text-sm text-muted">→ {r.mitigation}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "Schedule" && (
          <ol className="relative ml-1 border-l border-line">
            {plan.schedule.map((s, i) => {
              const newDay = s.day && (i === 0 || plan.schedule[i - 1].day !== s.day) && plan.schedule.some((x) => (x.day ?? 1) > 1);
              return (
                <li key={i} className="mb-5 ml-5">
                  {newDay && <div className="-ml-5 mb-3 pl-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">Day {s.day} · {fmtDate(addDays(b.date, (s.day ?? 1) - 1))}</div>}
                  <span className="absolute -left-[4px] mt-1.5 h-[7px] w-[7px] bg-accent" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-accent">{s.time}</span>
                    <span className="font-medium text-foreground">{s.title}</span>
                    <span className="text-xs text-subtle">{s.durationMin} min{s.owner ? ` · ${s.owner}` : ""}</span>
                  </div>
                  <p className="text-sm leading-[21px] text-muted">{s.detail}</p>
                </li>
              );
            })}
          </ol>
        )}

        {tab === "Budget" && <BudgetView plan={plan} />}

        {tab === "Venues" && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
            {plan.venues.map((v, i) => (
              <button
                key={v.name}
                onClick={() => onChange(reselectVenue(plan, i))}
                className={`rounded-xl border p-4 text-left transition ${i === plan.selectedVenue ? "border-accent bg-accent-soft" : "border-line hover:border-foreground/30"}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-subtle">{i === 0 ? "Top match" : `Alternate ${i}`}</span>
                  {i === plan.selectedVenue && <span className="flex items-center gap-1 text-xs font-medium text-accent"><Check size={12} /> Selected</span>}
                </div>
                <div className="font-medium text-foreground">{v.name}</div>
                <div className="text-sm text-muted">{v.neighborhood} · {v.style}</div>
                <div className="mt-2 flex gap-3 font-mono text-xs text-foreground">
                  <span>{v.capacity.toLocaleString()} cap</span>
                  <span>{money(v.pricePerHour)}/hr</span>
                  <span className="font-sans">{v.indoor ? "Indoor" : "Outdoor"}</span>
                </div>
                <p className="mt-2 text-sm leading-[21px] text-muted">{v.why}</p>
                <p className="mt-2 text-[11px] text-subtle">Rates are planning estimates — confirm with venue.</p>
              </button>
            ))}
            {plan.vendors.length > 0 && (
              <div className="mt-5 md:col-span-3">
                <h3 className="section-head">Vendors</h3>
                <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 md:gap-x-8">
                  {plan.vendors.map((v, i) => (
                    <div key={i} className="border-b border-line py-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium text-foreground">{v.category}</span><span className="font-mono text-foreground">{money(v.estCost)}</span></div>
                      <div className="text-muted">{v.suggestion}</div>
                      <div className="text-xs text-subtle">{v.contactTip}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "Tasks" && (
          <div>
            <div className="mb-2 h-1 overflow-hidden bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${(done / Math.max(1, plan.tasks.length)) * 100}%` }} />
            </div>
            {plan.tasks.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-1 py-3 text-sm hover:bg-surface/60">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => onChange({ ...plan, tasks: plan.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })}
                  className="h-4 w-4 accent-[#4f6146]"
                />
                <span className={`min-w-0 flex-1 ${t.done ? "text-subtle line-through" : "text-foreground"}`}>{t.title}</span>
                <span className="hidden text-xs text-muted sm:inline">{AGENTS[t.agent]?.name}</span>
                <span className="hidden text-xs text-subtle sm:inline">{t.owner}</span>
                <span className={`shrink-0 rounded-lg px-1.5 py-0.5 font-mono text-[11px] ${t.priority === "high" ? "bg-danger-soft text-danger" : "bg-surface text-muted"}`}>{t.due}</span>
              </label>
            ))}
          </div>
        )}

        {tab === "Permits" && (
          <div>
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface p-3 text-xs leading-[18px] text-muted">
              <FileCheck2 size={14} className="mt-0.5 shrink-0 text-accent" />
              Permits agent checklist for {venue?.name ?? "this venue"} in {b.city}. This is a planning aid, not legal advice: agencies, fees and lead times are typical estimates, so confirm each one with the issuing agency. Autopilot drafts the applications and pays the fees.
            </p>
            {(plan.permits ?? []).length === 0 && <p className="text-sm text-muted">No permits detected. Re-run the plan to generate a checklist.</p>}
            {(plan.permits ?? []).map((p) => {
              const filed = plan.tasks.find((x) => x.id === p.taskId)?.done;
              return (
                <div key={p.name} className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-medium text-foreground">{p.name}</span>
                      <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${filed ? "bg-success-soft text-success" : p.atRisk ? "bg-danger-soft text-danger" : "bg-surface text-muted"}`}>{filed ? "filed" : p.atRisk ? "expedite" : "to file"}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-muted">{p.agency}</div>
                    <div className="mt-1 text-xs leading-[18px] text-subtle">{p.why}</div>
                  </div>
                  <div className="text-left text-xs text-muted sm:text-right">
                    <div className="font-mono text-sm text-foreground">{p.fee ? `$${p.fee.toLocaleString()}` : "no fee"}</div>
                    <div>~{p.leadDays} days lead time</div>
                    <div className={p.atRisk ? "font-medium text-danger" : ""}>file by {p.deadline}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "Workflow" && <WorkflowTab plan={plan} onChange={onChange} />}

        {tab === "Ops" && <OpsTab plan={plan} />}

        {tab === "Autopilot" && <AutopilotPanel plan={plan} onChange={onChange} />}

        {tab === "Invite" && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-line p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Email</span>
                <CopyBtn text={`Subject: ${plan.invite.subject}\n\n${plan.invite.body}`} />
              </div>
              <div className="font-medium text-foreground">{plan.invite.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted">{plan.invite.body}</pre>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"><MessageSquare size={12} /> SMS reminder</span>
                <CopyBtn text={plan.invite.sms} />
              </div>
              <div className="rounded-xl rounded-bl-sm bg-accent-soft p-3 text-sm text-foreground">{plan.invite.sms}</div>
              <div className="mt-1 text-right font-mono text-[11px] text-subtle">{plan.invite.sms.length}/160</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetView({ plan }: { plan: EventPlan }) {
  const total = plan.budget.reduce((s, l) => s + l.amount, 0) || 1;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex h-3 gap-px overflow-hidden">
        {plan.budget.map((l, i) => (
          <div key={l.category} title={`${l.category} ${money(l.amount)}`} style={{ width: `${(l.amount / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div>
        {plan.budget.map((l, i) => (
          <div key={l.category} className="flex items-center gap-3 border-b border-line py-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-foreground sm:w-44 sm:flex-none sm:shrink-0">{l.category}</span>
            <span className="w-24 shrink-0 text-right font-mono text-foreground">{money(l.amount)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-subtle">{Math.round((l.amount / total) * 100)}%</span>
            <span className="hidden min-w-0 truncate text-muted sm:block">{l.note}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 border-t-2 border-foreground pt-2.5 text-sm font-semibold">
          <span className="w-2.5" />
          <span className="min-w-0 flex-1 sm:w-44 sm:flex-none">Total</span>
          <span className="w-24 text-right font-mono">{money(total)}</span>
          <span className="hidden font-normal text-muted sm:inline">≈ {money(total / plan.brief.guests)} / guest</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{icon} {label}</div>
      <div className="text-base font-semibold text-foreground">{value}</div>
      {sub && <div className="text-sm leading-[21px] text-muted">{sub}</div>}
    </div>
  );
}

function Score({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-success-soft text-success" : score >= 60 ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger";
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${tone}`} title="Critic's confidence in this plan">
      <Star size={13} className="fill-current" />
      <span className="font-mono text-sm font-semibold">{score}</span>
      <span className="text-xs">/100</span>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="flex items-center gap-1 text-xs text-muted hover:text-foreground" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {ok ? <Check size={12} /> : <Copy size={12} />} {ok ? "Copied" : "Copy"}
    </button>
  );
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmtDate = (d: string) => new Date(`${d}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function OpsTab({ plan }: { plan: EventPlan }) {
  const ops = plan.ops;
  if (!ops) return <p className="text-sm text-muted">Re-run the plan to size staffing, food and infrastructure.</p>;
  const today = new Date().toISOString().slice(0, 10);
  const doneIds = new Set(plan.tasks.filter((t) => t.done).map((t) => t.id));
  const live = (plan.autopilot?.purchases ?? []).filter((p) => ["auto_approved", "approved"].includes(p.status));
  const needDeposit = ["Venue", ...plan.vendors.map((v) => v.category)];
  const permits = plan.permits ?? [];
  const blockers = [
    ...permits.filter((p) => !doneIds.has(p.taskId ?? "")).map((p) => `${p.atRisk ? "Expedite" : "File"}: ${p.name}`),
    ...needDeposit.filter((c) => !live.some((p) => p.category === c)).map((c) => `No ${c} deposit yet`),
    ...plan.tasks.filter((t) => !t.done && t.due < today).map((t) => `Overdue: ${t.title}`),
  ];
  const pct = (n: number, d: number) => (d ? n / d : 1);
  const readiness = Math.round(100 * (0.5 * pct(doneIds.size, plan.tasks.length) + 0.25 * pct(permits.filter((p) => doneIds.has(p.taskId ?? "")).length, permits.length) + 0.25 * pct(needDeposit.filter((c) => live.some((p) => p.category === c)).length, needDeposit.length)));
  const card = "rounded-2xl border border-line p-5";
  const h = "section-head mb-3";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className={`${card} grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center`}>
        <div>
          <div className={h}>Readiness</div>
          <div className="font-display text-5xl text-foreground">{readiness}<span className="text-xl text-subtle">%</span></div>
        </div>
        <div className="min-w-0 text-sm">
          {blockers.length === 0 ? (
            <p className="text-success">Nothing blocking. Run the day-of brief.</p>
          ) : (
            <>
              <p className="mb-1 text-muted">{blockers.length} thing{blockers.length > 1 ? "s" : ""} still blocking the event:</p>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-foreground">
                {blockers.slice(0, 6).map((x) => <li key={x}>· {x}</li>)}
                {blockers.length > 6 && <li className="text-subtle">+{blockers.length - 6} more on Tasks and Permits</li>}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <section className={card}>
          <h3 className={h}>Staffing & safety</h3>
          <table className="w-full text-sm">
            <tbody>
              {ops.staffing.map((s) => (
                <tr key={s.role} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-accent">{s.count.toLocaleString()}</td>
                  <td className="py-1.5"><div>{s.role}</div><div className="text-xs text-muted">{s.note}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {ops.shifts.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
              {ops.shifts.map((x, i) => <span key={i} className="rounded border border-line px-1.5 py-0.5 font-mono">{x.label} {x.start}–{x.end} · {x.volunteers}</span>)}
            </div>
          )}
        </section>

        <section className={card}>
          <h3 className={h}>Infrastructure</h3>
          <table className="w-full text-sm">
            <tbody>
              {ops.infra.map((x) => (
                <tr key={x.item} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-accent">{x.qty}</td>
                  <td className="py-1.5"><div>{x.item}</div><div className="text-xs text-muted">{x.note}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">{ops.checkin.lanes > 0 && <><span className="font-mono text-accent">{ops.checkin.lanes}</span> check-in lanes. </>}{ops.checkin.note}</p>
        </section>
      </div>

      {ops.meals.length > 0 && (
        <section className={card}>
          <h3 className={h}>Food quantities</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr>
                  <th className="pb-1 font-normal">Meal</th>
                  <th className="pb-1 text-right font-normal">Servings</th>
                  {Object.keys(ops.meals[0].split).map((k) => <th key={k} className="pb-1 text-right font-normal capitalize">{k}</th>)}
                </tr>
              </thead>
              <tbody className="font-mono">
                {ops.meals.map((m, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 font-sans">{m.slot} <span className="text-xs text-subtle">D{m.day} {m.time}</span></td>
                    <td className="py-1.5 text-right">{m.servings.toLocaleString()}</td>
                    {Object.values(m.split).map((n, j) => <td key={j} className="py-1.5 text-right text-muted">{n.toLocaleString()}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Includes staff and a 5% buffer. Diet shares are typical estimates, boosted for diets named in the brief; replace them with registration data when you have it.</p>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {ops.sponsors.length > 0 && (
          <section className={card}>
            <h3 className={h}>Sponsorship</h3>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-sm">
              {ops.sponsors.map((t) => (
                <div key={t.tier} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 last:border-0">
                  <div className="min-w-0"><div>{t.tier} <span className="text-xs text-subtle">× {t.count}</span></div><div className="truncate text-xs text-muted">{t.perks}</div></div>
                  <span className="font-mono text-accent">${t.price.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm">Target <span className="font-mono">${ops.sponsorTarget.toLocaleString()}</span> covers <span className="font-mono text-accent">{Math.round((ops.sponsorTarget / plan.brief.budget) * 100)}%</span> of the budget; net cost <span className="font-mono">${Math.max(0, plan.brief.budget - ops.sponsorTarget).toLocaleString()}</span>.</p>
          </section>
        )}
        <section className={card}>
          <h3 className={h}>Policies to publish</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-sm">
            {ops.policies.map((x) => <li key={x.name}><div>{x.name}</div><div className="text-xs text-muted">{x.why}</div></li>)}
          </ul>
        </section>
      </div>

      <section className={card}>
        <h3 className={h}>Day-of run sheet: who handles what</h3>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1 text-sm">
          {ops.contacts.map((c) => (
            <div key={c.role} className="grid grid-cols-[minmax(0,1fr)] gap-x-3 border-b border-line py-1.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span>{c.role}</span>
              <span className="text-muted">{c.owner}</span>
              <span className="text-xs text-muted">{c.when}</span>
            </div>
          ))}
        </div>
      </section>
      <p className="text-center text-[11px] text-subtle">Ratios are planning rules of thumb. Confirm requirements with your venue, fire marshal and insurer.</p>
    </div>
  );
}
