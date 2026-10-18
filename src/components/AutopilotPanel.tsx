"use client";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Check, CreditCard, Loader2, Lock, Mail, Play, Receipt, RotateCcw, Search, ShieldCheck, ShieldX, Star, X } from "lucide-react";
import type { EventPlan, SpendMandate, VendorThread } from "@/lib/types";
import { OrganizerTexts } from "./OrganizerTexts";
import { committed, decide, defaultMandate, emptyAutopilot, isAutoDraft, negotiatedSavings, planSteps, refund, sendMessage, switchQuote, verifyAudit } from "@/lib/autopilot";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS: Record<string, string> = {
  auto_approved: "bg-success-soft text-success",
  approved: "bg-success-soft text-success",
  pending: "bg-warning-soft text-warning",
  rejected: "bg-surface text-muted",
  canceled: "bg-surface text-muted",
  refunded: "bg-accent-soft text-accent",
  blocked: "bg-danger-soft text-danger",
};

export function AutopilotPanel({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const [mandate, setMandate] = useState<SpendMandate>(plan.autopilot?.mandate ?? defaultMandate(plan));
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const [mailLive, setMailLive] = useState(false);
  useEffect(() => {
    fetch("/api/email").then((r) => r.json()).then((j) => setMailLive(!!j.live)).catch(() => {});
  }, []);
  const a = plan.autopilot;

  const run = async () => {
    setRunning(true);
    setFeed([]);
    await runAutopilot(plan, mandate, mailLive, onChange, (label) => setFeed((f) => [...f, label]));
    setRunning(false);
  };

  const pending = a?.purchases.filter((x) => x.status === "pending") ?? [];
  const spent = a ? committed(a.purchases) : 0;
  const intact = a ? verifyAudit(a.audit) : true;
  const loose = a ? a.outbox.filter((m) => m.channel === "email" && !a.threads?.some((t) => t.subject === m.subject)) : [];

  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-wrap:anywhere]">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 rounded-2xl border border-line p-5 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground"><ShieldCheck size={16} className="text-accent" /> Spend mandate</h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-[21px] text-muted">Your agents shop, compare and pay only inside these limits. Anything over the approval line waits for you. Each payment gets its own single-use card, and every action is written to a tamper-evident log.</p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <Num label="Total cap" value={mandate.totalCap} onChange={(v) => setMandate({ ...mandate, totalCap: v, approvalThreshold: mandate.approvalThreshold === mandate.totalCap ? v : mandate.approvalThreshold })} disabled={running} />
            <Num label="Per-purchase cap" value={mandate.perPurchaseCap} onChange={(v) => setMandate({ ...mandate, perPurchaseCap: v })} disabled={running} />
            <Num label="Ask me above" value={mandate.approvalThreshold} onChange={(v) => setMandate({ ...mandate, approvalThreshold: v })} disabled={running} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted">Allowed:</span>
            {Array.from(new Set([...defaultMandate(plan).allowedCategories, "Alcohol", "Gift cards"])).map((c) => {
              const on = mandate.allowedCategories.includes(c);
              return (
                <button
                  key={c}
                  disabled={running}
                  aria-pressed={on}
                  onClick={() => setMandate({ ...mandate, allowedCategories: on ? mandate.allowedCategories.filter((x) => x !== c) : [...mandate.allowedCategories, c] })}
                  className={`rounded-lg border px-2.5 py-[3px] text-xs transition ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-subtle line-through hover:text-muted"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col items-stretch justify-end gap-2.5">
          {a && (
            <div className="text-right">
              <div className="font-mono text-[22px] font-medium leading-7 text-foreground">{money(spent)}</div>
              <div className="text-xs text-muted">committed of {money(a.mandate.totalCap)}</div>
              <div className="mt-1.5 h-1 overflow-hidden bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (spent / Math.max(1, a.mandate.totalCap)) * 100)}%` }} /></div>
            </div>
          )}
          <button className="btn-primary py-2.5" onClick={run} disabled={running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : a ? <RotateCcw size={14} /> : <Play size={14} />} {a ? "Re-run Autopilot" : "Run Autopilot"}
          </button>
          <p className="text-center text-[11px] text-subtle">Demo: payments and messages are simulated</p>
        </div>
      </div>

      {feed.length > 0 && (
        <div className="scrollbar-thin max-h-40 overflow-y-auto rounded-xl border border-line bg-surface p-3 font-mono text-xs text-muted" aria-live="polite">
          {feed.map((f, i) => <div key={i} className="fade-up">› {f}</div>)}
          {running && <div className="text-subtle">…</div>}
        </div>
      )}

      {a && (
        <>
          {pending.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[#e9c995] bg-warning-soft">
              <h3 className="flex items-center gap-2 px-4 py-3.5 text-sm font-semibold text-[#7c3a06]"><Lock size={14} className="text-warning" /> {pending.length} {pending.length > 1 ? "purchases need" : "purchase needs"} your approval</h3>
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 border-t border-[#f0ddbb] bg-background px-4 py-3 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-foreground">{p.purpose}</span>
                    <span className="text-[13px] text-muted">{p.vendor}</span>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right font-mono text-[15px] font-medium text-foreground sm:w-24">{money(p.amount)}</span>
                  <button disabled={running} className="btn bg-accent px-3 py-[7px] text-[13px] font-semibold text-white hover:brightness-110" onClick={() => onChange(decide(plan, p.id, true))}><Check size={13} strokeWidth={2.4} /> Approve</button>
                  <button disabled={running} className="btn border border-line px-3 py-[7px] text-[13px] text-muted hover:bg-surface hover:text-foreground" onClick={() => onChange(decide(plan, p.id, false))}><X size={13} strokeWidth={2.4} /> Reject</button>
                </div>
              ))}
            </div>
          )}

          <OrganizerTexts plan={plan} onChange={onChange} running={running} />

          {(a.shortlists?.length ?? 0) > 0 && (
            <section>
              <h3 className="section-head"><Search size={14} /> What the agent compared{negotiatedSavings(a) > 0 && <span className="ml-auto font-mono text-xs font-medium normal-case tracking-normal text-success">negotiated {money(negotiatedSavings(a))} off</span>}</h3>
              <VendorCompare plan={plan} onChange={onChange} running={running} />
              <p className="mt-3 text-[11px] text-subtle">Negotiation is simulated: each demo vendor has a hidden floor price. The agent never goes below it, and only haggles with vendors that can deliver in time.</p>
            </section>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
            <section>
              <h3 className="section-head"><CreditCard size={14} /> Payments</h3>
              {a.purchases.map((p) => (
                <div key={p.id} className={`border-b border-line py-3 text-sm ${p.status === "refunded" || p.status === "canceled" ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 font-medium text-foreground">{p.purpose}</span>
                    <span className={`shrink-0 whitespace-nowrap font-mono text-foreground ${p.status === "refunded" || p.status === "canceled" ? "line-through" : ""}`}>{money(p.amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${STATUS[p.status]}`}>{p.status.replace("_", " ")}</span>
                    <span className="text-muted">{p.reason}</span>
                  </div>
                  <div className="mt-1 text-xs text-subtle">{p.vendor}</div>
                  {p.card && (
                    <details className="mt-2 rounded-lg bg-surface px-2.5 py-2 text-[11px] text-muted">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-foreground"><Receipt size={11} /> Receipt · {p.card}</summary>
                      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono">
                        <dt className="text-subtle">merchant</dt><dd>{p.vendor}</dd>
                        <dt className="text-subtle">amount</dt><dd>{money(p.amount)}</dd>
                        <dt className="text-subtle">card</dt><dd>{p.card} (single-use, locked to merchant)</dd>
                        <dt className="text-subtle">idempotency</dt><dd>{p.idempotencyKey}</dd>
                        <dt className="text-subtle">time</dt><dd>{new Date(p.ts).toLocaleString()}</dd>
                        {p.why && (<><dt className="text-subtle">why</dt><dd className="font-sans">{p.why}</dd></>)}
                      </dl>
                      {(p.status === "approved" || p.status === "auto_approved") && (
                        <button disabled={running} onClick={() => onChange(refund(plan, p.id))} className="mt-2 flex items-center gap-1 rounded-lg border border-line bg-background px-2 py-0.5 text-foreground hover:bg-surface disabled:opacity-40">
                          <RotateCcw size={11} /> Refund to card
                        </button>
                      )}
                    </details>
                  )}
                </div>
              ))}
            </section>
            {(a.threads?.length || loose.length) ? (
              <section>
                <h3 className="section-head"><Mail size={14} /> Email conversations<span className="ml-auto font-mono text-xs font-medium normal-case tracking-normal text-muted">{(a.threads?.length ?? 0) + loose.length}</span></h3>
                {(a.threads ?? []).map((t) => (
                  <details key={t.id} className="group border-b border-line py-3 text-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-foreground">{t.vendor} <span className="text-muted">· {t.category}</span></span>
                      {t.agreed ?? t.theirPrice ? <span className="shrink-0 font-mono text-xs text-muted">{money(t.agreed ?? t.theirPrice!)}</span> : null}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${THREAD_STYLE[t.status]}`}>{THREAD_LABEL[t.status]}</span>
                    </summary>
                    <div className="mt-2 text-xs text-subtle">Target {money(t.target)} · ceiling {money(t.ceiling)}{t.offer ? ` · our offer ${money(t.offer)}` : ""} · {t.rounds} counter{t.rounds === 1 ? "" : "s"} · {t.followups} follow-up{t.followups === 1 ? "" : "s"}</div>
                    <ol className="mt-2 flex flex-col gap-2">
                      {t.log.map((e, i) => (
                        <li key={i} className={`rounded-lg border border-line p-2 ${e.dir === "in" ? "bg-surface" : ""}`}>
                          <div className="text-xs font-medium text-subtle">{e.dir === "out" ? "EventPilot" : t.vendor} · {new Date(e.ts).toLocaleString()}{e.price ? ` · ${money(e.price)}` : ""}</div>
                          <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{e.body}</pre>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
                {loose.map((m) => (
                  <details key={m.id} className="group border-b border-line py-3 text-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-foreground">{m.subject}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${m.status === "sent" ? "bg-accent-soft text-accent" : "bg-surface text-muted"}`}>{m.status === "sent" ? "Sent · awaiting reply" : "Drafted"}</span>
                    </summary>
                    <div className="mt-2 text-xs text-subtle">To: {m.to}</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{m.body}</pre>
                  </details>
                ))}
              </section>
            ) : null}
          </div>

          <section>
            <h3 className="section-head">
              {intact ? <ShieldCheck size={14} className="text-success" /> : <ShieldX size={14} className="text-danger" />}
              Audit log <span className="text-xs font-normal normal-case tracking-normal text-muted">{intact ? "hash chain verified" : "chain broken!"} · {a.audit.length} entries</span>
            </h3>
            <div className="scrollbar-thin mt-3 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface font-mono text-[11px]">
              {a.audit.map((e, i) => (
                <div key={i} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="hidden shrink-0 text-subtle sm:inline">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="w-20 shrink-0 text-accent">{e.actor}</span>
                  <span className="w-24 shrink-0 truncate text-foreground sm:w-28">{e.action}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title={e.detail}>{e.detail}</span>
                  <span className="hidden shrink-0 text-subtle sm:inline">#{e.hash}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Num({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted">
      {label}
      <div className="relative mt-1.5">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-subtle">$</span>
        <input type="number" min={0} disabled={disabled} className="input bg-surface pl-6 font-mono" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} />
      </div>
    </label>
  );
}

const THREAD_LABEL: Record<VendorThread["status"], string> = { awaiting_reply: "Awaiting reply", negotiating: "Negotiating", agreed: "Agreed · needs OK", booked: "Booked", declined: "Declined", needs_you: "Needs you" };
const THREAD_STYLE: Record<VendorThread["status"], string> = { awaiting_reply: "bg-surface text-muted", negotiating: "bg-warning-soft text-warning", agreed: "bg-warning-soft text-warning", booked: "bg-success-soft text-success", declined: "bg-surface text-muted", needs_you: "bg-danger-soft text-danger" };

/** Runs every Autopilot step in order, publishing the plan after each one so checklists tick off live. */
export async function runAutopilot(plan: EventPlan, mandate: SpendMandate, mailLive: boolean, onChange: (p: EventPlan) => void, onStep: (label: string) => void) {
  let state = plan.autopilot ? { ...plan.autopilot, mandate } : emptyAutopilot(mandate);
  let p: EventPlan = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
  for (const step of planSteps(plan, mandate, { awaitVendors: mailLive })) {
    onStep(step.label);
    ({ a: state, plan: p } = step.apply(state, p));
    onChange({ ...p, autopilot: state });
    await new Promise((r) => setTimeout(r, 260));
  }
  // Send vendor emails and permit filings: real email (redirected to the test inbox) when mail is live, simulated otherwise.
  p = { ...p, autopilot: state };
  for (const m of state.outbox.filter(isAutoDraft)) {
    onStep(`Autopilot: ${mailLive ? "email" : "send (simulated, email is off)"} → ${m.to}`);
    if (mailLive) {
      const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: p.id, outboxId: m.id, to: m.to, subject: m.subject, body: m.body, title: p.brief.title }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (r.plan) p = r.plan;
      else if (!r.ok) continue;
      else p = sendMessage(p, m.id, "autopilot");
    } else p = sendMessage(p, m.id, "autopilot", " (simulated: email is off)");
    onChange(p);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function VendorCompare({ plan, onChange, running }: { plan: EventPlan; onChange: (p: EventPlan) => void; running: boolean }) {
  const lists = plan.autopilot?.shortlists ?? [];
  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, lists.length - 1);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const b = btns.current[idx];
      if (b) setPill({ left: b.offsetLeft, width: b.offsetWidth });
    };
    place();
    btns.current[idx]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [idx, lists.length]);
  if (!lists.length) return null;
  const sl = lists[idx];
  return (
    <div className="pt-4">
      <div role="tablist" aria-label="Vendor categories" className="relative flex gap-1 overflow-x-auto rounded-xl bg-surface p-1">
        <span aria-hidden className="absolute bottom-1 top-1 rounded-lg bg-background shadow-sm ring-1 ring-line transition-all duration-300 ease-out" style={{ left: pill.left, width: pill.width }} />
        {lists.map((l, i) => (
          <button
            key={l.category}
            ref={(el) => { btns.current[i] = el; }}
            role="tab"
            aria-selected={i === idx}
            onClick={() => setSel(i)}
            className={`relative z-10 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-300 ${i === idx ? "font-semibold text-foreground" : "font-medium text-muted hover:text-foreground"}`}
          >
            {l.category}
            <span className="font-mono text-[11px] font-normal text-subtle">{money(l.quotes[l.pick]?.price ?? 0)}</span>
          </button>
        ))}
      </div>
      <div key={sl.category} role="tabpanel" className="fade-up mt-4 flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-foreground">{sl.category} · {sl.quotes.length} quotes</span>
          <span className="font-mono text-xs text-subtle">target {money(sl.target)}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sl.quotes.map((q, i) => (
            <div key={q.vendor} className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-xs ${i === sl.pick ? "border-[1.5px] border-accent bg-accent-soft" : "border border-line"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`min-w-0 truncate text-[13px] text-foreground ${i === sl.pick ? "font-semibold" : "font-medium"}`}>{q.vendor}</span>
                <span className={`shrink-0 whitespace-nowrap font-mono text-[13px] text-foreground ${i === sl.pick ? "font-semibold" : ""}`}>
                  {q.listPrice && q.listPrice > q.price && <span className="mr-1.5 font-normal text-subtle line-through">{money(q.listPrice)}</span>}
                  {money(q.price)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-muted">
                <span className="flex items-center gap-0.5"><Star size={10} className="fill-current" />{q.rating}</span>
                <span>· {q.leadDays}d lead</span>
                <span>· {q.cancellable ? "free cancel" : "non-refundable"}</span>
              </div>
              {q.note && <div className="text-muted">{q.note}</div>}
              {q.rounds && (
                <details className="mt-0.5">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-success">
                    Negotiated {q.listPrice && q.listPrice > q.price ? `−${Math.round(((q.listPrice - q.price) / q.listPrice) * 100)}%` : "at list"} · {q.rounds.length} messages
                  </summary>
                  <ol className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-0.5 border-l border-line pl-2 text-[11px] text-muted">
                    {q.rounds.map((r, j) => <li key={j}><span className="font-medium text-foreground">{r.by === "agent" ? "Agent" : "Vendor"}:</span> {r.note}</li>)}
                  </ol>
                </details>
              )}
              <div className="pt-1">
                {i === sl.pick ? (
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-accent">Agent pick</span>
                ) : (
                  <button disabled={running} onClick={() => onChange(switchQuote(plan, sl.category, i))} className="text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-40">
                    Choose this instead
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs leading-[18px] text-muted">{sl.why}</p>
      </div>
    </div>
  );
}
