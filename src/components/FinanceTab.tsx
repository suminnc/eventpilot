"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Receipt, Scale, ShieldCheck, Wallet } from "lucide-react";
import type { EventPlan } from "@/lib/types";
import {
  addItem, addMember, budgetTotals, can, categoryTotals, decideRequest, directorDecide, financeReview, itemsOf, markReimbursementPaid, setMemberRole,
  submitReimbursement, submitRequest, syncFinance, updateItem, type BudgetRequest, type CheckResult, type Finance, type Role,
} from "@/lib/finance";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const CHIP: Record<CheckResult, string> = { pass: "bg-success-soft text-success", warn: "bg-warning-soft text-warning", fail: "bg-danger-soft text-danger" };
const ROLES: Role[] = ["Admin", "Director", "Finance", "Viewer"];
const today = () => new Date().toISOString().slice(0, 10);

/** Finance workflows (ported from The Fub): master budget, reimbursements, budget requests, access and activity. */
export function FinanceTab({ plan, onChange }: { plan: EventPlan; onChange: (p: EventPlan) => void }) {
  const f = syncFinance(plan);
  const [who, setWho] = useState(f.members[0]?.email ?? "");
  const me = f.members.find((m) => m.email === who) ?? f.members[0];
  const role: Role = me?.role ?? "Viewer";
  const actor = me?.name ?? "Organizer";
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<"" | "reimb" | "request">("");
  const items = f.categories.flatMap((c) => itemsOf(c).map((i) => ({ ...i, label: `${c.name} › ${i.name}` })));
  const blankR = { name: "", email: "", team: "", itemId: items[0]?.id ?? "", vendor: "", purchaseDate: today(), amount: 0, description: "", receiptName: "", firstReimbursement: false, payee: true };
  const [r, setR] = useState(blankR);
  const blankQ = { name: actor, team: "", itemId: items[0]?.id ?? "", fromItemId: "", amount: 0, minAmount: 0, reason: "", neededBy: plan.brief.date, urgency: "Medium" as BudgetRequest["urgency"] };
  const [q, setQ] = useState(blankQ);
  const [newItem, setNewItem] = useState({ name: "", vendor: "", allocated: 0 });
  const [member, setMember] = useState({ email: "", name: "", role: "Viewer" as Role });
  const act = (fn: (x: Finance) => Finance, after?: () => void) => {
    try {
      setErr("");
      onChange({ ...plan, finance: fn(f) });
      after?.();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const t = budgetTotals(f.categories);
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const edit = can(role, "budget.edit");

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          {[["Allocated", t.allocated], ["Committed", t.actualCost], ["Spent", t.spent], ["Left", t.left]].map(([k, v]) => (
            <div key={k as string}><p className="text-[12px] text-muted">{k}</p><p className="font-display text-xl font-semibold tabular-nums">{money(v as number)}</p></div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Viewing as</span>
          <select className="input py-1.5" value={who} onChange={(e) => setWho(e.target.value)}>
            {f.members.map((m) => <option key={m.email} value={m.email}>{m.name} ({m.role})</option>)}
          </select>
        </label>
      </div>
      {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

      <section className="card overflow-x-auto p-5">
        <h3 className="section-head mb-1 flex items-center gap-2"><Wallet size={16} /> Master budget</h3>
        <p className="mb-3 text-[12px] text-muted">Built from the plan&apos;s budget. Vendor rows update as Autopilot negotiates and pays; reimbursements add to Spent.{edit ? " Click a category to edit its items." : ""}</p>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-[12px] text-muted"><th className="py-1.5 font-medium">Category</th><th className="text-right font-medium">Allocated</th><th className="text-right font-medium">Committed</th><th className="text-right font-medium">Spent</th><th className="text-right font-medium">Left</th></tr></thead>
          <tbody>
            {f.categories.map((c) => {
              const ct = categoryTotals(c);
              const isOpen = open === c.id;
              return (
                <Fragment key={c.id}>
                  <tr className="cursor-pointer border-t border-line hover:bg-surface" onClick={() => setOpen(isOpen ? null : c.id)}>
                    <td className="py-2 font-medium"><span className="inline-flex items-center gap-1">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{c.name}</span></td>
                    <td className="text-right tabular-nums">{money(ct.allocated)}</td>
                    <td className={`text-right tabular-nums ${ct.actualCost > ct.allocated ? "text-danger" : ""}`}>{money(ct.actualCost)}</td>
                    <td className="text-right tabular-nums">{money(ct.spent)}</td>
                    <td className={`text-right tabular-nums ${ct.left < 0 ? "text-danger" : ""}`}>{money(ct.left)}</td>
                  </tr>
                  {isOpen && itemsOf(c).map((i) => (
                    <tr key={i.id} className="bg-surface/60 text-[13px]">
                      <td className="py-1.5 pl-6"><span className="font-medium">{i.name}</span> <span className="text-muted">· {i.vendor}{i.note ? ` · ${i.note}` : ""}</span></td>
                      {(["allocated", "actualCost", "spent"] as const).map((k) => (
                        <td key={k} className="text-right">
                          {edit ? <input key={`${i.id}-${k}-${i[k]}`} type="number" min={0} defaultValue={Math.round(i[k])} onBlur={(e) => num(e.target.value) !== Math.round(i[k]) && act((x) => updateItem(x, i.id, { [k]: num(e.target.value) }, role, actor))} className="input w-24 py-1 text-right text-[13px]" aria-label={`${i.name} ${k}`} /> : <span className="tabular-nums">{money(i[k])}</span>}
                        </td>
                      ))}
                      <td className="text-right tabular-nums">{money(i.allocated - i.spent)}</td>
                    </tr>
                  ))}
                  {isOpen && edit && (
                    <tr className="bg-surface/60"><td colSpan={5} className="py-2 pl-6">
                      <div className="flex flex-wrap gap-2">
                        <input className="input py-1 text-[13px]" placeholder="New item" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
                        <input className="input py-1 text-[13px]" placeholder="Vendor" value={newItem.vendor} onChange={(e) => setNewItem({ ...newItem, vendor: e.target.value })} />
                        <input className="input w-28 py-1 text-[13px]" type="number" min={0} placeholder="Allocated" value={newItem.allocated || ""} onChange={(e) => setNewItem({ ...newItem, allocated: num(e.target.value) })} />
                        <button className="btn-ghost px-3 py-1 text-[13px]" onClick={() => act((x) => addItem(x, c.id, { ...newItem, vendor: newItem.vendor || "TBD", actualCost: 0, spent: 0, note: "" }, role, actor), () => setNewItem({ name: "", vendor: "", allocated: 0 }))}>Add item</button>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="section-head flex items-center gap-2"><Receipt size={16} /> Reimbursements</h3>
          <button className="btn-ghost px-3 py-1.5 text-[13px]" onClick={() => setForm(form === "reimb" ? "" : "reimb")}>{form === "reimb" ? "Close" : "New reimbursement"}</button>
        </div>
        <p className="mb-3 text-[12px] text-muted">Receipts are checked automatically → finance review → director approval → payout. Payouts are simulated; no real money moves.</p>
        {form === "reimb" && (
          <div className="mb-4 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
            <input className="input" placeholder="Your name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
            <input className="input" placeholder="Email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} />
            <input className="input" placeholder="Team" value={r.team} onChange={(e) => setR({ ...r, team: e.target.value })} />
            <select className="input sm:col-span-2" value={r.itemId} onChange={(e) => setR({ ...r, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select>
            <input className="input" placeholder="Store / vendor" value={r.vendor} onChange={(e) => setR({ ...r, vendor: e.target.value })} />
            <input className="input" type="date" value={r.purchaseDate} onChange={(e) => setR({ ...r, purchaseDate: e.target.value })} />
            <input className="input" type="number" min={0} step="0.01" placeholder="Amount" value={r.amount || ""} onChange={(e) => setR({ ...r, amount: Number(e.target.value) || 0 })} />
            <input className="input text-[13px]" type="file" accept=".pdf,.png,.jpg,.jpeg,.heic" onChange={(e) => setR({ ...r, receiptName: e.target.files?.[0]?.name ?? "" })} aria-label="Receipt" />
            <input className="input sm:col-span-3" placeholder="What was it for?" value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.firstReimbursement} onChange={(e) => setR({ ...r, firstReimbursement: e.target.checked })} /> First reimbursement</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.payee} onChange={(e) => setR({ ...r, payee: e.target.checked })} /> Already set up as a payee</label>
            <button className="btn-primary px-3" onClick={() => act((x) => submitReimbursement(x, r), () => { setR(blankR); setForm(""); })}>Submit</button>
          </div>
        )}
        {f.reimbursements.length ? f.reimbursements.map((x) => (
          <div key={x.id} className="border-t border-line py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1"><b className="font-semibold">{x.id}</b> · {x.name} · {x.vendor} · <b>{money(x.amount)}</b> <span className="text-muted">· {x.status}{x.paymentId ? ` · ${x.paymentId}` : ""}</span></span>
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${CHIP[x.check.verdict]}`}>receipt {x.check.verdict}</span>
              {x.status === "Waiting on finance" && can(role, "finance.review") && <>
                <button className="btn-ghost px-2 py-1 text-[12px]" disabled={x.check.verdict === "fail"} onClick={() => act((y) => financeReview(y, x.id, "Approved", role, actor))}>Finance approve</button>
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => financeReview(y, x.id, "Needs Info", role, actor, "More info requested"))}>Needs info</button>
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => financeReview(y, x.id, "Rejected", role, actor))}>Reject</button>
              </>}
              {x.status === "Ready for director" && can(role, "director.decide") && <>
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => directorDecide(y, x.id, true, role, actor))}>Director approve</button>
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => directorDecide(y, x.id, false, role, actor))}>Deny</button>
              </>}
              {x.status === "Approved – payment pending" && can(role, "finance.review") && <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => markReimbursementPaid(y, x.id, role, actor))}>Send payment</button>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">{x.check.checks.map((c) => <span key={c.label} title={c.detail} className={`rounded-md px-1.5 py-0.5 text-[11px] ${CHIP[c.result]}`}>{c.label}: {c.detail}</span>)}</div>
          </div>
        )) : <p className="text-sm text-muted">No reimbursements yet.</p>}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="section-head flex items-center gap-2"><Scale size={16} /> Budget requests</h3>
          <button className="btn-ghost px-3 py-1.5 text-[13px]" onClick={() => setForm(form === "request" ? "" : "request")}>{form === "request" ? "Close" : "Request more budget"}</button>
        </div>
        {form === "request" && (
          <div className="mb-4 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
            <input className="input" placeholder="Your name" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} />
            <input className="input" placeholder="Team" value={q.team} onChange={(e) => setQ({ ...q, team: e.target.value })} />
            <select className="input" value={q.urgency} onChange={(e) => setQ({ ...q, urgency: e.target.value as BudgetRequest["urgency"] })}>{["Low", "Medium", "High", "Critical"].map((u) => <option key={u}>{u}</option>)}</select>
            <label className="text-[12px] text-muted sm:col-span-3">Add money to<select className="input mt-1 w-full" value={q.itemId} onChange={(e) => setQ({ ...q, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
            <label className="text-[12px] text-muted sm:col-span-3">Take it from<select className="input mt-1 w-full" value={q.fromItemId} onChange={(e) => setQ({ ...q, fromItemId: e.target.value })}><option value="">Contingency</option>{items.filter((i) => i.id !== q.itemId).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
            <input className="input" type="number" min={0} placeholder="Amount" value={q.amount || ""} onChange={(e) => setQ({ ...q, amount: num(e.target.value) })} />
            <input className="input" type="number" min={0} placeholder="Minimum that still works" value={q.minAmount || ""} onChange={(e) => setQ({ ...q, minAmount: num(e.target.value) })} />
            <input className="input" type="date" value={q.neededBy} onChange={(e) => setQ({ ...q, neededBy: e.target.value })} />
            <input className="input sm:col-span-2" placeholder="Why?" value={q.reason} onChange={(e) => setQ({ ...q, reason: e.target.value })} />
            <button className="btn-primary px-3" onClick={() => act((x) => submitRequest(x, { ...q, fromItemId: q.fromItemId || undefined, minAmount: q.minAmount || undefined }), () => { setQ(blankQ); setForm(""); })}>Submit</button>
          </div>
        )}
        {f.requests.length ? f.requests.map((x) => (
          <div key={x.id} className="border-t border-line py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1"><b className="font-semibold">{x.id}</b> · {x.name} · <b>{money(x.amount)}</b> for {items.find((i) => i.id === x.itemId)?.label ?? x.itemId} <span className="text-muted">· {x.status}{x.approvedAmount ? ` (${money(x.approvedAmount)})` : ""}</span></span>
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${x.suggestion.decision === "Approve" ? CHIP.pass : x.suggestion.decision === "Partial" ? CHIP.warn : CHIP.fail}`}>Suggested: {x.suggestion.decision}{x.suggestion.decision === "Partial" ? ` ${money(x.suggestion.amount)}` : ""}</span>
              {x.status === "Waiting on director" && can(role, "director.decide") && <>
                {x.suggestion.decision !== "Deny" && <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => decideRequest(y, x.id, x.suggestion.decision, x.suggestion.amount, role, actor))}>Accept suggestion</button>}
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => decideRequest(y, x.id, "Approve", x.amount, role, actor))}>Approve full</button>
                <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => act((y) => decideRequest(y, x.id, "Deny", 0, role, actor))}>Deny</button>
              </>}
            </div>
            <p className="mt-1 text-[12px] text-muted">{x.suggestion.reasoning.join(" · ")}{x.reason ? ` · “${x.reason}”` : ""}</p>
          </div>
        )) : <p className="text-sm text-muted">No budget requests. Teams ask for more here; EventPilot suggests approve, partial or deny from what&apos;s left.</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="section-head mb-3 flex items-center gap-2"><ShieldCheck size={16} /> Access</h3>
          {f.members.map((m) => (
            <div key={m.email} className="flex items-center gap-2 border-t border-line py-2 text-sm">
              <span className="min-w-0 flex-1">{m.name} <span className="text-muted">· {m.email}</span></span>
              {can(role, "access.manage") ? <select className="input py-1 text-[13px]" value={m.role} onChange={(e) => act((x) => setMemberRole(x, m.email, e.target.value as Role, role, actor))}>{ROLES.map((v) => <option key={v}>{v}</option>)}</select> : <span className="text-[13px] text-muted">{m.role}</span>}
            </div>
          ))}
          {can(role, "access.manage") && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="input flex-1 py-1 text-[13px]" placeholder="email@team.org" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
              <select className="input py-1 text-[13px]" value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value as Role })}>{ROLES.map((v) => <option key={v}>{v}</option>)}</select>
              <button className="btn-ghost px-3 py-1 text-[13px]" onClick={() => act((x) => addMember(x, member.email, member.name, member.role, role, actor), () => setMember({ email: "", name: "", role: "Viewer" }))}>Grant</button>
            </div>
          )}
          <p className="mt-2 text-[12px] text-muted">Admin: everything · Director: final approvals · Finance: reviews and budget edits · Viewer: submit only.</p>
        </section>
        <section className="card p-5">
          <h3 className="section-head mb-2">Finance activity</h3>
          {f.activity.length ? (
            <ul className="scrollbar-thin max-h-64 overflow-y-auto text-[13px]">
              {f.activity.slice(0, 60).map((a) => <li key={a.id} className="border-t border-line py-1.5"><span className="text-muted">{new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> · <b className="font-semibold">{a.actor}</b> · {a.action} {a.target}{a.detail ? ` · ${a.detail}` : ""}</li>)}
            </ul>
          ) : <p className="text-sm text-muted">Every finance action is logged here.</p>}
        </section>
      </div>
    </div>
  );
}
