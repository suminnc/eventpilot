"use client";
import { useState } from "react";
import {
  CalendarDays, Copy, Download, FileText, MapPin, MessageSquare, ShieldAlert, Users, Wallet, CloudSun, Clock, Star, Check,
} from "lucide-react";
import type { EventPlan } from "@/lib/types";
import { AGENTS } from "@/lib/types";
import { planToICS, planToMarkdown } from "@/lib/export";
import { AutopilotPanel } from "./AutopilotPanel";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const TABS = ["Overview", "Schedule", "Budget", "Venues", "Tasks", "Invite", "Autopilot"] as const;
type Tab = (typeof TABS)[number];
const COLORS = ["#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#fb923c", "#f472b6", "#f87171", "#94a3b8", "#22d3ee", "#c084fc"];

export function PlanView({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const b = plan.brief;
  const venue = plan.venues[plan.selectedVenue];
  const done = plan.tasks.filter((t) => t.done).length;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-white/40">
              {b.eventType}
              <span className={`rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal ${plan.mode === "llm" ? "bg-accent/15 text-accent-soft" : "bg-white/10 text-white/60"}`}>
                {plan.mode === "llm" ? plan.model : "offline planner"}
              </span>
            </div>
            <h2 className="font-display text-4xl leading-tight">{b.title}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/60">
              <span className="flex items-center gap-1"><CalendarDays size={14} /> {fmtDate(b.date)} · {b.startTime}</span>
              <span className="flex items-center gap-1"><Clock size={14} /> {b.durationHours}h</span>
              <span className="flex items-center gap-1"><Users size={14} /> {b.guests.toLocaleString()} guests</span>
              <span className="flex items-center gap-1"><Wallet size={14} /> {money(b.budget)}</span>
              <span className="flex items-center gap-1"><MapPin size={14} /> {venue?.name ?? b.city}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Score score={plan.score} />
            <button className="btn-ghost" onClick={() => download(`${slug(b.title)}.ics`, planToICS(plan), "text/calendar")} title="Add event + prep tasks to calendar">
              <Download size={14} /> .ics
            </button>
            <button className="btn-ghost" onClick={() => download(`${slug(b.title)}.md`, planToMarkdown(plan), "text/markdown")} title="Export plan as Markdown">
              <FileText size={14} /> .md
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
              {t}
              {t === "Tasks" && <span className="ml-1 text-white/40">{done}/{plan.tasks.length}</span>}
              {t === "Autopilot" && <span className="ml-1.5 rounded bg-accent/20 px-1 text-[10px] text-accent-soft">{plan.autopilot?.purchases.some((p) => p.status === "pending") ? "approve" : "new"}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "Overview" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-xl border border-white/10 bg-accent/[0.06] p-4 text-[15px] leading-relaxed text-white/85">{plan.summary}</div>
            <Stat icon={<MapPin size={16} />} label="Venue" value={venue?.name ?? "TBD"} sub={venue?.why} />
            <Stat
              icon={<CloudSun size={16} />}
              label="Weather"
              value={plan.weather?.summary ?? "—"}
              sub={plan.weather?.highC != null ? `High ${Math.round(plan.weather.highC)}°C / ${Math.round((plan.weather.highC * 9) / 5 + 32)}°F · ${plan.weather.precipChance ?? "?"}% precip · ${plan.weather.source}` : undefined}
            />
            <div className="md:col-span-2">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70"><ShieldAlert size={15} /> Critic review</h3>
              <div className="grid gap-2">
                {plan.risks.map((r, i) => (
                  <div key={i} className="flex gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                    <span className={`mt-0.5 h-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${r.level === "high" ? "bg-red-500/20 text-red-300" : r.level === "medium" ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/15 text-emerald-200"}`}>{r.level}</span>
                    <div>
                      <div className="text-white/90">{r.issue}</div>
                      <div className="text-white/50">→ {r.mitigation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "Schedule" && (
          <ol className="relative ml-2 border-l border-white/10">
            {plan.schedule.map((s, i) => {
              const newDay = s.day && (i === 0 || plan.schedule[i - 1].day !== s.day) && plan.schedule.some((x) => (x.day ?? 1) > 1);
              return (
                <li key={i} className="mb-4 ml-5">
                  {newDay && <div className="-ml-5 mb-3 text-xs font-semibold uppercase tracking-wider text-accent">Day {s.day} · {fmtDate(addDays(b.date, (s.day ?? 1) - 1))}</div>}
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-amber-200">{s.time}</span>
                    <span className="font-medium">{s.title}</span>
                    <span className="text-xs text-white/40">{s.durationMin} min{s.owner ? ` · ${s.owner}` : ""}</span>
                  </div>
                  <p className="text-sm text-white/60">{s.detail}</p>
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
                className={`rounded-xl border p-4 text-left transition ${i === plan.selectedVenue ? "border-accent/60 bg-accent/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-white/40">{i === 0 ? "Top match" : `Alternate ${i}`}</span>
                  {i === plan.selectedVenue && <span className="flex items-center gap-1 text-xs text-accent"><Check size={12} /> Selected</span>}
                </div>
                <div className="font-medium">{v.name}</div>
                <div className="text-sm text-white/50">{v.neighborhood} · {v.style}</div>
                <div className="mt-2 flex gap-3 text-xs text-white/60">
                  <span>{v.capacity.toLocaleString()} cap</span>
                  <span>{money(v.pricePerHour)}/hr</span>
                  <span>{v.indoor ? "Indoor" : "Outdoor"}</span>
                </div>
                <p className="mt-2 text-sm text-white/70">{v.why}</p>
                <p className="mt-2 text-[11px] text-white/30">Rates are planning estimates — confirm with venue.</p>
              </button>
            ))}
            {plan.vendors.length > 0 && (
              <div className="md:col-span-3">
                <h3 className="mb-2 mt-2 text-sm font-medium text-white/70">Vendors</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {plan.vendors.map((v, i) => (
                    <div key={i} className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium">{v.category}</span><span className="text-white/60">{money(v.estCost)}</span></div>
                      <div className="text-white/70">{v.suggestion}</div>
                      <div className="text-xs text-white/40">{v.contactTip}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "Tasks" && (
          <div className="grid gap-2">
            <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-accent transition-all" style={{ width: `${(done / Math.max(1, plan.tasks.length)) * 100}%` }} />
            </div>
            {plan.tasks.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm hover:border-white/20">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => onChange({ ...plan, tasks: plan.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })}
                  className="h-4 w-4 accent-[#ff6a3d]"
                />
                <span className={`flex-1 ${t.done ? "text-white/40 line-through" : ""}`}>{t.title}</span>
                <span className="hidden text-xs sm:inline" style={{ color: AGENTS[t.agent]?.color }}>{AGENTS[t.agent]?.name}</span>
                <span className="text-xs text-white/40">{t.owner}</span>
                <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${t.priority === "high" ? "bg-red-500/15 text-red-200" : "bg-white/5 text-white/50"}`}>{t.due}</span>
              </label>
            ))}
          </div>
        )}

        {tab === "Autopilot" && <AutopilotPanel plan={plan} onChange={onChange} />}

        {tab === "Invite" && (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-white/40">Email</span>
                <CopyBtn text={`Subject: ${plan.invite.subject}\n\n${plan.invite.body}`} />
              </div>
              <div className="font-medium">{plan.invite.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-white/75">{plan.invite.body}</pre>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/40"><MessageSquare size={12} /> SMS reminder</span>
                <CopyBtn text={plan.invite.sms} />
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-accent/20 p-3 text-sm">{plan.invite.sms}</div>
              <div className="mt-1 text-right text-[11px] text-white/30">{plan.invite.sms.length}/160</div>
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
      <div className="flex h-4 overflow-hidden rounded-full">
        {plan.budget.map((l, i) => (
          <div key={l.category} title={`${l.category} ${money(l.amount)}`} style={{ width: `${(l.amount / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div className="grid gap-2">
        {plan.budget.map((l, i) => (
          <div key={l.category} className="flex items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-44 shrink-0">{l.category}</span>
            <span className="w-24 shrink-0 text-right font-mono">{money(l.amount)}</span>
            <span className="w-12 shrink-0 text-right text-white/40">{Math.round((l.amount / total) * 100)}%</span>
            <span className="truncate text-white/50">{l.note}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-3 border-t border-white/10 pt-2 text-sm font-medium">
          <span className="w-2.5" />
          <span className="w-44">Total</span>
          <span className="w-24 text-right font-mono">{money(total)}</span>
          <span className="text-white/40">≈ {money(total / plan.brief.guests)} / guest</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-white/40">{icon} {label}</div>
      <div className="font-medium">{value}</div>
      {sub && <div className="mt-1 text-sm text-white/55">{sub}</div>}
    </div>
  );
}

function Score({ score }: { score: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5" title="Critic's confidence in this plan">
      <Star size={14} style={{ color }} />
      <span className="font-mono text-sm" style={{ color }}>{score}</span>
      <span className="text-xs text-white/40">/100</span>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="flex items-center gap-1 text-xs text-white/50 hover:text-white" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
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
