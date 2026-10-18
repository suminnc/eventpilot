"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Clock, FileText, Gift, Megaphone, Package, Siren, Utensils, Wallet } from "lucide-react";
import type { EventPlan } from "@/lib/types";
import {
  CATEGORIES, SEVERITIES, alerts, approvalRule, checkIn, confirmMeal, dayOpsOf, eventWindow, generateNudges, headcount, localIso, paymentAction,
  postmortem, queueNudge, reportIncident, rosNow, setDeliverable, setRosStatus, setShipment, shiftSchedule, updateIncident, updatePrize,
  type DayOps, type IncidentCategory, type PrizeStatus, type Severity,
} from "@/lib/dayops";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SEV: Record<Severity, string> = { critical: "bg-danger-soft text-danger", high: "bg-danger-soft text-danger", medium: "bg-warning-soft text-warning", low: "bg-surface text-muted" };
const t = (s: string) => s.slice(11, 16);
const PRIZE_FLOW: PrizeStatus[] = ["unassigned", "winner_selected", "tax_form_sent", "shipped", "delivered"];

/** Day-of operations console (ported from Gatherly): run-of-show, incidents, approvals, logistics, sponsors, prizes, nudges, post-mortem. */
export function DayOpsTab({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const o = dayOpsOf(plan);
  const w = eventWindow(plan);
  const [clock, setClock] = useState<"now" | "event">("event");
  const [offset, setOffset] = useState(0);
  const now = clock === "now" ? localIso(new Date()) : localIso(new Date(new Date(w.start).getTime() + offset * 60000));
  const [me, setMe] = useState(o.organizers[0] ?? "Organizer");
  const [err, setErr] = useState("");
  const [inc, setInc] = useState({ category: "medical" as IncidentCategory, severity: "medium" as Severity, location: "", description: "" });
  const [report, setReport] = useState("");
  const act = (fn: (x: DayOps) => DayOps) => {
    try {
      setErr("");
      onChange({ ...plan, dayops: fn(o) });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const { live, next } = rosNow(o, now);
  const xs = useMemo(() => alerts(o, now, w.start, w.end), [o, now, w.start, w.end]);
  const hc = headcount(o);
  const days = Math.max(1, Math.ceil(plan.brief.durationHours / 24));

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Clock size={15} className="text-muted" />
          <span className="text-muted">Clock</span>
          <select className="input py-1.5" value={clock} onChange={(e) => setClock(e.target.value as "now" | "event")}>
            <option value="event">Event time (simulate)</option>
            <option value="now">Real time</option>
          </select>
          {clock === "event" && (
            <>
              <input type="range" min={-120} max={days * 1440} step={15} value={offset} onChange={(e) => setOffset(Number(e.target.value))} className="w-40 accent-[#4f6146]" aria-label="Event clock" />
              <span className="font-medium tabular-nums">{now.replace("T", " ")}</span>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Acting as</span>
          <select className="input py-1.5" value={me} onChange={(e) => setMe(e.target.value)}>
            {o.organizers.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {!plan.dayops && <p className="text-sm text-muted">Built from this plan. Changes you make here are saved with the event.</p>}

      <section className="card p-5">
        <h3 className="section-head mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Needs attention ({xs.length})</h3>
        {xs.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {xs.slice(0, 10).map((x) => (
              <li key={x.ref + x.title} className="flex items-start gap-2">
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${SEV[x.severity]}`}>{x.severity}</span>
                <span><b className="font-semibold">{x.title}:</b> {x.detail}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Nothing needs attention right now.</p>}
      </section>

      <section className="card p-5">
        <h3 className="section-head mb-3 flex items-center gap-2"><Megaphone size={16} /> Run of show</h3>
        <div className="flex flex-col divide-y divide-line">
          {o.ros.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${live.includes(r.id) ? "bg-accent-soft/60 -mx-2 rounded-lg px-2" : ""}`}>
              <span className="w-28 shrink-0 whitespace-nowrap tabular-nums text-muted">D{r.day} {t(r.startsAt)}–{t(r.endsAt)}</span>
              <span className="min-w-0 flex-1 font-medium">{r.title}{live.includes(r.id) && <span className="ml-2 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">live</span>}{next[0] === r.id && <span className="ml-2 text-[11px] text-muted">up next</span>}</span>
              {r.delayMin !== 0 && <span className="text-[12px] text-warning">{r.delayMin > 0 ? "+" : ""}{r.delayMin} min</span>}
              <span className="ml-auto flex shrink-0 items-center gap-1">
              <select className="input py-1 text-[13px]" value={r.status} onChange={(e) => act((x) => setRosStatus(x, r.id, e.target.value as typeof r.status, me))} aria-label={`Status for ${r.title}`}>
                {["planned", "live", "done", "delayed", "cancelled"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => shiftSchedule(x, r.id, 15, "day", me).ops)} title="Push this and everything after it today by 15 minutes">+15 rest of day</button>
              <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => shiftSchedule(x, r.id, 15, "item", me).ops)}>+15 this</button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h3 className="section-head mb-3 flex items-center gap-2"><Siren size={16} /> Incidents</h3>
        <div className="mb-4 grid gap-2 sm:grid-cols-[auto_auto_1fr_2fr_auto]">
          <select className="input" value={inc.category} onChange={(e) => setInc({ ...inc, category: e.target.value as IncidentCategory })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select>
          <select className="input" value={inc.severity} onChange={(e) => setInc({ ...inc, severity: e.target.value as Severity })}>{SEVERITIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input className="input" placeholder="Where" value={inc.location} onChange={(e) => setInc({ ...inc, location: e.target.value })} />
          <input className="input" placeholder="What happened" value={inc.description} onChange={(e) => setInc({ ...inc, description: e.target.value })} />
          <button className="btn-primary px-3" onClick={() => act((x) => { const r = reportIncident(x, { ...inc, reportedBy: me }).ops; setInc({ ...inc, description: "", location: "" }); return r; })}>Report</button>
        </div>
        <p className="mb-2 text-[12px] text-muted">Routing: {Object.entries(o.routing).map(([k, v]) => `${k.replace("_", " ")} → ${v}`).join(" · ")}. Critical goes to {o.director} too.</p>
        {o.incidents.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${SEV[i.severity]}`}>{i.severity}</span>
            <span className="min-w-0 flex-1"><b className="font-semibold">#{i.id} {i.category.replace("_", " ")}</b> · {i.description} · {i.location} · <span className="text-muted">{i.owner}</span></span>
            <select className="input py-1 text-[13px]" value={i.status} onChange={(e) => act((x) => updateIncident(x, i.id, { status: e.target.value as typeof i.status }, me))}>
              {["open", "acknowledged", "resolved"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="section-head mb-3 flex items-center gap-2"><Wallet size={16} /> Payment approvals</h3>
          <p className="mb-2 text-[12px] text-muted">Up to $500: 1 organizer · up to $5,000: 2 organizers · above: {o.director}. Marking paid records it; no money moves.</p>
          {o.payments.length ? o.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
              <span className="min-w-0 flex-1">{p.payee} · {p.source} · <b>{money(p.amount)}</b> <span className="text-muted">({p.status}{p.status === "pending" ? `, ${p.approvals.length}/${approvalRule(p.amount).director ? 1 : approvalRule(p.amount).count} ${approvalRule(p.amount).label}` : ""})</span></span>
              {p.status === "pending" && <><button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => paymentAction(x, p.id, "approve", me))}>Approve</button><button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => paymentAction(x, p.id, "reject", me))}>Reject</button></>}
              {p.status === "approved" && <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => paymentAction(x, p.id, "mark-paid", me))}>Mark paid</button>}
            </div>
          )) : <p className="text-sm text-muted">No vendor balances due yet. They appear once Autopilot books vendors.</p>}
        </section>

        <section className="card p-5">
          <h3 className="section-head mb-3 flex items-center gap-2"><Utensils size={16} /> Headcount & meals</h3>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span><b>{hc.checkedIn}</b> checked in of {hc.registered}</span>
            <span className="text-muted">expecting {hc.expected}{hc.checkedIn ? "" : " (55% show rate)"}</span>
            <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => checkIn(x, Math.min(50, x.attendees.registered - x.attendees.checkedIn), me))}>+50 check-ins</button>
          </div>
          {o.meals.length ? o.meals.map((m) => {
            const h = hc.meals.find((x) => x.id === m.id)!;
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
                <span className="w-20 shrink-0 tabular-nums text-muted">{m.scheduledAt.slice(5, 10)} {t(m.scheduledAt)}</span>
                <span className="min-w-0 flex-1">{m.meal} · {m.quantity} servings · {m.vendor}{m.needsReschedule && <span className="ml-1 text-warning">· moved, tell vendor</span>}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${h.flag === "ok" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{h.flag}</span>
                {m.confirmedAt ? <span className="text-[12px] text-success">confirmed</span> : <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => confirmMeal(x, m.id, me))}>Vendor confirmed</button>}
              </div>
            );
          }) : <p className="text-sm text-muted">No meal service in this plan.</p>}
        </section>

        <section className="card p-5">
          <h3 className="section-head mb-3 flex items-center gap-2"><Package size={16} /> Shipments</h3>
          {o.shipments.length ? o.shipments.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
              <span className="min-w-0 flex-1">{s.item} · {s.vendor} · <span className="text-muted">due {s.arriveBy.replace("T", " ")}</span></span>
              <select className="input py-1 text-[13px]" value={s.status} onChange={(e) => act((x) => setShipment(x, s.id, e.target.value as typeof s.status, me))}>{["Ordered", "Shipped", "Delivered"].map((v) => <option key={v}>{v}</option>)}</select>
            </div>
          )) : <p className="text-sm text-muted">Nothing shipping to the venue.</p>}
        </section>

        <section className="card p-5">
          <h3 className="section-head mb-3 flex items-center gap-2"><Gift size={16} /> Prizes</h3>
          {o.prizes.length ? o.prizes.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
              <span className="min-w-0 flex-1">{p.prize}{p.winnerTeam && <span className="text-muted"> · {p.winnerTeam}</span>}</span>
              {p.status === "unassigned" ? (
                <input className="input w-36 py-1 text-[13px]" placeholder="Winning team ↵" onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget.value.trim()) act((x) => updatePrize(x, p.id, { winnerTeam: e.currentTarget.value.trim(), status: "winner_selected" }, me)); }} />
              ) : (
                <select className="input py-1 text-[13px]" value={p.status} onChange={(e) => act((x) => updatePrize(x, p.id, { status: e.target.value as PrizeStatus }, me))}>{PRIZE_FLOW.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
              )}
            </div>
          )) : <p className="text-sm text-muted">No prize budget in this plan.</p>}
        </section>
      </div>

      <section className="card p-5">
        <h3 className="section-head mb-3">Sponsor deliverables</h3>
        {o.deliverables.length ? (
          <div className="flex flex-col">
            {[...new Set(o.deliverables.map((d) => d.sponsor))].map((sp) => {
              const ds = o.deliverables.filter((d) => d.sponsor === sp);
              return (
                <div key={sp} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
                  <span className="w-44 shrink-0 font-medium">{sp} <span className="text-[12px] text-muted">{ds.filter((d) => d.status === "done").length}/{ds.length}</span></span>
                  {ds.map((d) => (
                    <label key={d.id} title={`${d.description} · due ${d.dueAt.replace("T", " ")}`} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${d.status === "done" ? "border-success/40 bg-success-soft text-success" : d.dueAt < now ? "border-danger/40 text-danger" : "border-line text-muted"}`}>
                      <input type="checkbox" checked={d.status === "done"} onChange={(e) => act((x) => setDeliverable(x, d.id, e.target.checked ? "done" : "todo", me))} className="accent-[#4f6146]" />
                      {d.kind} · {d.dueAt.slice(5, 10)}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted">No sponsors in this plan.</p>}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="section-head">Attendee nudges</h3>
          <button className="btn-ghost px-3 py-1.5 text-[13px]" onClick={() => act((x) => generateNudges(x, now, me).ops)}>Draft nudges</button>
        </div>
        {o.nudges.length ? o.nudges.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
            <span className="w-24 shrink-0 text-[12px] text-muted">{n.audience.replace("_", " ")}{n.sendAt ? ` · ${t(n.sendAt)}` : ""}</span>
            <span className="min-w-0 flex-1">{n.text}</span>
            {n.status === "scheduled" ? <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((x) => queueNudge(x, n.id, me))}>Queue</button> : <span className="text-[12px] text-success">queued</span>}
          </div>
        )) : <p className="text-sm text-muted">Drafts reminders from the run of show, plus nudges for solo attendees and people who haven&apos;t checked in. Attendee messaging is simulated.</p>}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="section-head flex items-center gap-2"><FileText size={16} /> Post-mortem</h3>
          <button className="btn-ghost px-3 py-1.5 text-[13px]" onClick={() => { setReport(postmortem(plan, o)); onChange({ ...plan, dayops: { ...o, postmortemAt: localIso(new Date()) } }); }}>Generate</button>
        </div>
        {report ? <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface p-4 text-[13px] leading-6">{report}</pre> : <p className="text-sm text-muted">Spend, attendance, meals, incidents, delays, sponsors and prizes in one report.</p>}
      </section>

      <section className="card p-5">
        <h3 className="section-head mb-2">Ops log</h3>
        <ul className="scrollbar-thin max-h-56 overflow-y-auto text-[13px]">
          {o.log.slice(0, 60).map((l, i) => <li key={i} className="border-t border-line py-1.5"><span className="text-muted tabular-nums">{l.at.replace("T", " ")}</span> · <b className="font-semibold">{l.actor}</b> · {l.detail}</li>)}
        </ul>
      </section>
    </div>
  );
}
