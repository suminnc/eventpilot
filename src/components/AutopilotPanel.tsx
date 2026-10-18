"use client";
import { useState } from "react";
import { Check, CreditCard, Loader2, Lock, Mail, MessageSquare, Play, Receipt, RotateCcw, Search, ShieldCheck, ShieldX, Star, X } from "lucide-react";
import type { EventPlan, SpendMandate } from "@/lib/types";
import { committed, decide, defaultMandate, emptyAutopilot, planSteps, refund, sendMessage, switchQuote, verifyAudit } from "@/lib/autopilot";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS: Record<string, string> = {
  auto_approved: "bg-emerald-500/15 text-emerald-200",
  approved: "bg-emerald-500/15 text-emerald-200",
  pending: "bg-amber-500/20 text-amber-200",
  rejected: "bg-white/10 text-white/50",
  canceled: "bg-white/10 text-white/50",
  refunded: "bg-sky-500/15 text-sky-200",
  blocked: "bg-red-500/20 text-red-200",
};

export function AutopilotPanel({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const [mandate, setMandate] = useState<SpendMandate>(plan.autopilot?.mandate ?? defaultMandate(plan));
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const a = plan.autopilot;

  const run = async () => {
    setRunning(true);
    setFeed([]);
    let state = emptyAutopilot(mandate);
    let p: EventPlan = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
    for (const step of planSteps(plan, mandate)) {
      setFeed((f) => [...f, step.label]);
      ({ a: state, plan: p } = step.apply(state, p));
      onChange({ ...p, autopilot: state });
      await new Promise((r) => setTimeout(r, 260));
    }
    setRunning(false);
  };

  const pending = a?.purchases.filter((x) => x.status === "pending") ?? [];
  const spent = a ? committed(a.purchases) : 0;
  const intact = a ? verifyAudit(a.audit) : true;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 md:grid-cols-[1fr_auto]">
        <div>
          <h3 className="flex items-center gap-2 font-medium"><ShieldCheck size={16} className="text-accent" /> Spend mandate</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/55">Your agents shop, compare and pay only inside these limits. Anything over the approval line waits for you. Each payment gets its own single-use card, and every action is written to a tamper-evident log.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Num label="Total cap" value={mandate.totalCap} onChange={(v) => setMandate({ ...mandate, totalCap: v })} disabled={running} />
            <Num label="Per-purchase cap" value={mandate.perPurchaseCap} onChange={(v) => setMandate({ ...mandate, perPurchaseCap: v })} disabled={running} />
            <Num label="Ask me above" value={mandate.approvalThreshold} onChange={(v) => setMandate({ ...mandate, approvalThreshold: v })} disabled={running} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-white/40">Allowed:</span>
            {Array.from(new Set([...defaultMandate(plan).allowedCategories, "Alcohol", "Gift cards"])).map((c) => {
              const on = mandate.allowedCategories.includes(c);
              return (
                <button
                  key={c}
                  disabled={running}
                  aria-pressed={on}
                  onClick={() => setMandate({ ...mandate, allowedCategories: on ? mandate.allowedCategories.filter((x) => x !== c) : [...mandate.allowedCategories, c] })}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-white/10 text-white/40 line-through"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col items-stretch justify-end gap-2 md:w-56">
          {a && (
            <div className="text-right text-sm">
              <div className="font-mono text-lg">{money(spent)}</div>
              <div className="text-xs text-white/40">committed of {money(a.mandate.totalCap)}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (spent / Math.max(1, a.mandate.totalCap)) * 100)}%` }} /></div>
            </div>
          )}
          <button className="btn-primary" onClick={run} disabled={running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {a ? "Re-run Autopilot" : "Run Autopilot"}
          </button>
          <p className="text-center text-[11px] text-white/35">Demo: payments and messages are simulated</p>
        </div>
      </div>

      {feed.length > 0 && (
        <div className="scrollbar-thin max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/60" aria-live="polite">
          {feed.map((f, i) => <div key={i} className="fade-up">› {f}</div>)}
          {running && <div className="text-white/30">…</div>}
        </div>
      )}

      {a && (
        <>
          {pending.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-100"><Lock size={14} /> {pending.length} {pending.length > 1 ? "purchases need" : "purchase needs"} your approval</h3>
              <div className="grid gap-2">
                {pending.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-black/30 p-3 text-sm">
                    <span className="flex-1">{p.purpose} · <span className="text-white/60">{p.vendor}</span></span>
                    <span className="font-mono">{money(p.amount)}</span>
                    <button disabled={running} className="btn bg-emerald-500/20 px-3 py-1 text-emerald-100 hover:bg-emerald-500/30" onClick={() => onChange(decide(plan, p.id, true))}><Check size={13} /> Approve</button>
                    <button disabled={running} className="btn bg-white/5 px-3 py-1 text-white/60 hover:bg-white/10" onClick={() => onChange(decide(plan, p.id, false))}><X size={13} /> Reject</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(a.shortlists?.length ?? 0) > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70"><Search size={14} /> What the agent compared</h3>
              <div className="grid gap-3 lg:grid-cols-3">
                {a.shortlists!.map((sl) => (
                  <div key={sl.category} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="font-medium">{sl.category}</span>
                      <span className="text-xs text-white/40">target {money(sl.target)}</span>
                    </div>
                    <div className="grid gap-1.5">
                      {sl.quotes.map((q, i) => (
                        <div key={q.vendor} className={`rounded-lg border p-2 text-xs ${i === sl.pick ? "border-accent/50 bg-accent/10" : "border-white/5"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-white/90">{q.vendor}</span>
                            <span className="font-mono">{money(q.price)}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-white/45">
                            <span className="flex items-center gap-0.5"><Star size={10} className="fill-current" />{q.rating}</span>
                            <span>{q.leadDays}d lead</span>
                            <span>{q.cancellable ? "free cancel" : "non-refundable"}</span>
                          </div>
                          {q.note && <div className="mt-0.5 text-white/55">{q.note}</div>}
                          <div className="mt-1">
                            {i === sl.pick ? (
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Agent pick</span>
                            ) : (
                              <button disabled={running} onClick={() => onChange(switchQuote(plan, sl.category, i))} className="text-[11px] text-white/60 underline-offset-2 hover:text-white hover:underline disabled:opacity-40">
                                Choose this instead
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{sl.why}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70"><CreditCard size={14} /> Payments</h3>
              <div className="grid gap-2">
                {a.purchases.map((p) => (
                  <div key={p.id} className={`rounded-lg border border-white/10 bg-black/20 p-3 text-sm ${p.status === "refunded" || p.status === "canceled" ? "opacity-60" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.purpose}</span>
                      <span className={`font-mono ${p.status === "refunded" || p.status === "canceled" ? "line-through" : ""}`}>{money(p.amount)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${STATUS[p.status]}`}>{p.status.replace("_", " ")}</span>
                      <span className="text-white/50">{p.reason}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/40">{p.vendor}</div>
                    {p.card && (
                      <details className="mt-2 rounded-md bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/55">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5"><Receipt size={11} /> Receipt · {p.card}</summary>
                        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
                          <dt className="text-white/35">merchant</dt><dd>{p.vendor}</dd>
                          <dt className="text-white/35">amount</dt><dd>{money(p.amount)}</dd>
                          <dt className="text-white/35">card</dt><dd>{p.card} (single-use, locked to merchant)</dd>
                          <dt className="text-white/35">idempotency</dt><dd>{p.idempotencyKey}</dd>
                          <dt className="text-white/35">time</dt><dd>{new Date(p.ts).toLocaleString()}</dd>
                          {p.why && (<><dt className="text-white/35">why</dt><dd className="font-sans">{p.why}</dd></>)}
                        </dl>
                        {(p.status === "approved" || p.status === "auto_approved") && (
                          <button disabled={running} onClick={() => onChange(refund(plan, p.id))} className="mt-2 flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20 disabled:opacity-40">
                            <RotateCcw size={11} /> Refund to card
                          </button>
                        )}
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70"><Mail size={14} /> Outbox</h3>
              <div className="grid gap-2">
                {a.outbox.map((m) => (
                  <details key={m.id} className="group rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      {m.channel === "sms" ? <MessageSquare size={13} className="text-white/50" /> : <Mail size={13} className="text-white/50" />}
                      <span className="flex-1 truncate">{m.subject}</span>
                      {m.status === "sent" ? (
                        <span className="text-xs text-emerald-300">Sent</span>
                      ) : (
                        <button disabled={running} className="rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-40" onClick={(e) => { e.preventDefault(); onChange(sendMessage(plan, m.id)); }}>Approve & send</button>
                      )}
                    </summary>
                    <div className="mt-2 text-xs text-white/40">To: {m.to}</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-white/70">{m.body}</pre>
                  </details>
                ))}
              </div>
            </section>
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/70">
              {intact ? <ShieldCheck size={14} className="text-emerald-300" /> : <ShieldX size={14} className="text-red-300" />}
              Audit log <span className="text-xs font-normal text-white/40">{intact ? "hash chain verified" : "chain broken!"} · {a.audit.length} entries</span>
            </h3>
            <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/30 font-mono text-[11px]">
              {a.audit.map((e, i) => (
                <div key={i} className="flex gap-3 border-b border-white/5 px-3 py-1.5 last:border-0">
                  <span className="text-white/30">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="w-20 shrink-0 text-accent-soft">{e.actor}</span>
                  <span className="w-28 shrink-0 text-white/70">{e.action}</span>
                  <span className="flex-1 truncate text-white/50" title={e.detail}>{e.detail}</span>
                  <span className="text-white/25">#{e.hash}</span>
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
    <label className="text-xs text-white/50">
      {label}
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">$</span>
        <input type="number" min={0} disabled={disabled} className="input pl-6 font-mono" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} />
      </div>
    </label>
  );
}
