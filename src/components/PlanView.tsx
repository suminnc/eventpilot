"use client";
import { useState } from "react";
import {
  FileCheck2,
  CalendarDays, Copy, Download, FileText, MapPin, MessageSquare, ShieldAlert, Users, Wallet, CloudSun, Clock, Star, Check,
} from "lucide-react";
import type { EventPlan } from "@/lib/types";
import { AGENTS } from "@/lib/types";
import { planToICS, planToMarkdown } from "@/lib/export";
import { AutopilotPanel } from "./AutopilotPanel";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const TABS = ["Overview", "Schedule", "Budget", "Venues", "Tasks", "Permits", "Invite", "Autopilot"] as const;
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
            <div className="grid gap-8 md:grid-cols-2">
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
                  <div className="flex flex-col gap-0.5">
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
          <div className="grid gap-3 md:grid-cols-3">
            {plan.venues.map((v, i) => (
              <button
                key={v.name}
                onClick={() => onChange({ ...plan, selectedVenue: i })}
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
                <div className="grid md:grid-cols-2 md:gap-x-8">
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
                <span className={`flex-1 ${t.done ? "text-subtle line-through" : "text-foreground"}`}>{t.title}</span>
                <span className="hidden text-xs text-muted sm:inline">{AGENTS[t.agent]?.name}</span>
                <span className="text-xs text-subtle">{t.owner}</span>
                <span className={`rounded-lg px-1.5 py-0.5 font-mono text-[11px] ${t.priority === "high" ? "bg-danger-soft text-danger" : "bg-surface text-muted"}`}>{t.due}</span>
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
                <div key={p.name} className="grid gap-2 border-b border-line py-3.5 sm:grid-cols-[1fr_auto] sm:gap-6">
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

        {tab === "Autopilot" && <AutopilotPanel plan={plan} onChange={onChange} />}

        {tab === "Invite" && (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
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
    <div className="grid gap-5">
      <div className="flex h-3 gap-px overflow-hidden">
        {plan.budget.map((l, i) => (
          <div key={l.category} title={`${l.category} ${money(l.amount)}`} style={{ width: `${(l.amount / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div>
        {plan.budget.map((l, i) => (
          <div key={l.category} className="flex items-center gap-3 border-b border-line py-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-44 shrink-0 text-foreground">{l.category}</span>
            <span className="w-24 shrink-0 text-right font-mono text-foreground">{money(l.amount)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-subtle">{Math.round((l.amount / total) * 100)}%</span>
            <span className="truncate text-muted">{l.note}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 border-t-2 border-foreground pt-2.5 text-sm font-semibold">
          <span className="w-2.5" />
          <span className="w-44">Total</span>
          <span className="w-24 text-right font-mono">{money(total)}</span>
          <span className="font-normal text-muted">≈ {money(total / plan.brief.guests)} / guest</span>
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
