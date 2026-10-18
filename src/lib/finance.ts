import type { EventPlan } from "./types";

/** Finance workflows, ported from The Fub (the-fub/src/lib/store.tsx): master budget (categories → subcategories → items),
 * reimbursements with automatic receipt checks → finance review → director approval → simulated payout,
 * budget requests with a suggested decision that updates the budget, roles and an activity log. Pure functions over plan.finance. */

export type Role = "Admin" | "Director" | "Finance" | "Viewer";
export type Permission = "finance.review" | "director.decide" | "access.manage" | "budget.edit" | "submit";
export const PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ["finance.review", "director.decide", "access.manage", "budget.edit", "submit"],
  Director: ["director.decide", "submit"],
  Finance: ["finance.review", "budget.edit", "submit"],
  Viewer: ["submit"],
};
export type CheckResult = "pass" | "warn" | "fail";
export type ReceiptCheck = { verdict: CheckResult; checks: { label: string; result: CheckResult; detail: string }[] };
export type BudgetItem = { id: string; name: string; vendor: string; allocated: number; actualCost: number; spent: number; note: string; source?: string };
export type Subcategory = { id: string; name: string; items: BudgetItem[] };
export type FinCategory = { id: string; name: string; owner: string; allocated: number; subcategories: Subcategory[] };
export type ReimbursementStatus = "Waiting on finance" | "Ready for director" | "Approved – payment pending" | "Paid" | "Denied";
export type Reimbursement = {
  id: string; submittedAt: string; name: string; email: string; team: string; itemId: string; vendor: string; purchaseDate: string; amount: number;
  description: string; receiptName: string; firstReimbursement: boolean; payee: boolean; check: ReceiptCheck; status: ReimbursementStatus;
  financeNotes?: string; director?: string; paymentId?: string; paidAt?: string;
};
export type Decision = "Approve" | "Partial" | "Deny";
export type BudgetRequest = {
  id: string; submittedAt: string; name: string; team: string; itemId: string; fromItemId?: string; amount: number; minAmount?: number; reason: string;
  neededBy: string; urgency: "Low" | "Medium" | "High" | "Critical"; suggestion: { decision: Decision; amount: number; reasoning: string[] };
  status: "Waiting on director" | "Approved" | "Partially approved" | "Denied"; approvedAmount?: number; director?: string;
};
export type Member = { email: string; name: string; role: Role };
export type Activity = { id: string; at: string; actor: string; action: string; target: string; detail?: string };
export type Finance = { version: 1; categories: FinCategory[]; reimbursements: Reimbursement[]; requests: BudgetRequest[]; members: Member[]; activity: Activity[] };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const slugId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16) || "CAT";
let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`.toUpperCase();
const SPENT = ["auto_approved", "approved"];

export const itemsOf = (c: FinCategory) => c.subcategories.flatMap((s) => s.items);
export function categoryTotals(c: FinCategory) {
  const it = itemsOf(c);
  const spent = it.reduce((s, i) => s + i.spent, 0);
  const itemAllocated = it.reduce((s, i) => s + i.allocated, 0);
  return { allocated: c.allocated, actualCost: it.reduce((s, i) => s + i.actualCost, 0), spent, left: c.allocated - spent, itemAllocated, unassigned: c.allocated - itemAllocated };
}
export function budgetTotals(cs: FinCategory[]) {
  const t = cs.map(categoryTotals);
  const allocated = t.reduce((s, x) => s + x.allocated, 0);
  const spent = t.reduce((s, x) => s + x.spent, 0);
  return { allocated, actualCost: t.reduce((s, x) => s + x.actualCost, 0), spent, left: allocated - spent };
}
export function findItem(cs: FinCategory[], id: string) {
  for (const category of cs) for (const subcategory of category.subcategories) {
    const item = subcategory.items.find((i) => i.id === id);
    if (item) return { category, subcategory, item };
  }
}
export const itemPath = (r: NonNullable<ReturnType<typeof findItem>>) => `${r.category.name} › ${r.subcategory.name} › ${r.item.name}`;
const mapItems = (cs: FinCategory[], fn: (i: BudgetItem) => BudgetItem) => cs.map((c) => ({ ...c, subcategories: c.subcategories.map((s) => ({ ...s, items: s.items.map(fn) })) }));
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["and", "the", "misc"].includes(w));
const related = (a: string, b: string) => words(a).some((w) => words(b).some((v) => v.startsWith(w.slice(0, 4))));

/** Items Autopilot created (vendor deals) for a budget line, rebuilt from purchases + vendor threads. */
function autopilotItems(plan: EventPlan, line: string): BudgetItem[] {
  const a = plan.autopilot;
  if (!a) return [];
  const out = new Map<string, BudgetItem>();
  for (const p of a.purchases.filter((x) => related(x.category, line) && x.status !== "blocked")) {
    const key = p.vendor;
    const cur = out.get(key) ?? { id: `AP-${slugId(p.vendor)}`, name: p.purpose.replace(/\s*deposit.*$/i, "") || p.category, vendor: p.vendor, allocated: 0, actualCost: 0, spent: 0, note: "", source: "autopilot" };
    cur.actualCost += ["refunded", "rejected", "canceled"].includes(p.status) ? 0 : p.amount;
    cur.spent += SPENT.includes(p.status) ? p.amount : 0;
    cur.note = p.status === "pending" ? `${money(p.amount)} waiting on your approval` : cur.note;
    out.set(key, cur);
  }
  for (const t of (a.threads ?? []).filter((x) => related(x.category, line))) {
    const cur = out.get(t.vendor) ?? { id: `AP-${slugId(t.vendor)}`, name: t.category, vendor: t.vendor, allocated: 0, actualCost: 0, spent: 0, note: "", source: "autopilot" };
    cur.allocated = t.target;
    cur.actualCost = t.status === "declined" ? cur.actualCost : (t.agreed ?? t.theirPrice ?? cur.actualCost);
    cur.note = `Vendor email: ${t.status.replace("_", " ")}${cur.note ? ` · ${cur.note}` : ""}`;
    out.set(t.vendor, cur);
  }
  for (const s of (a.shortlists ?? []).filter((x) => related(x.category, line))) {
    const q = s.quotes[s.pick];
    const cur = out.get(q.vendor);
    if (cur) cur.allocated ||= s.target;
    else out.set(q.vendor, { id: `AP-${slugId(q.vendor)}`, name: s.category, vendor: q.vendor, allocated: s.target, actualCost: q.price, spent: 0, note: `Picked from ${s.quotes.length} quotes`, source: "autopilot" });
  }
  return [...out.values()];
}

/** Build or refresh the master budget from the plan: one category per budget line; Autopilot items are rebuilt, manual items and reimbursement spend are kept. */
export function syncFinance(plan: EventPlan): Finance {
  const prev = plan.finance;
  const categories = plan.budget.map((l): FinCategory => {
    const id = slugId(l.category);
    const old = prev?.categories.find((c) => c.id === id);
    const auto = autopilotItems(plan, l.category);
    const subs = (old?.subcategories ?? []).map((s) => ({ ...s, items: s.items.filter((i) => i.source !== "autopilot") }));
    const vendors: Subcategory = { id: `${id}-VENDORS`, name: "Vendors", items: [...auto, ...(subs.find((s) => s.id === `${id}-VENDORS`)?.items ?? [])] };
    const rest = subs.filter((s) => s.id !== `${id}-VENDORS`);
    if (!vendors.items.length && !rest.length) vendors.items.push({ id: `${id}-PLAN`, name: l.category, vendor: "TBD", allocated: l.amount, actualCost: 0, spent: 0, note: l.note, source: "plan" });
    return { id, name: l.category, owner: old?.owner ?? "Finance", allocated: old?.allocated ?? l.amount, subcategories: [vendors, ...rest] };
  });
  const extra = (prev?.categories ?? []).filter((c) => !categories.some((x) => x.id === c.id));
  return {
    version: 1,
    categories: [...categories, ...extra],
    reimbursements: prev?.reimbursements ?? [],
    requests: prev?.requests ?? [],
    members: prev?.members ?? [
      { email: "organizer@eventpilot.app", name: "You (organizer)", role: "Admin" },
      { email: "director@eventpilot.app", name: "Event director", role: "Director" },
      { email: "finance@eventpilot.app", name: "Finance lead", role: "Finance" },
    ],
    activity: prev?.activity ?? [],
  };
}

export const can = (role: Role, p: Permission) => PERMISSIONS[role].includes(p);
const guard = (role: Role, p: Permission) => {
  if (!can(role, p)) throw new Error(`${role} can't do that (needs ${p}).`);
};
const log = (f: Finance, actor: string, action: string, target: string, detail?: string): Finance => ({ ...f, activity: [{ id: newId("A"), at: new Date().toISOString(), actor, action, target, detail }, ...f.activity].slice(0, 400) });

/** The Fub's receipt checks, computed: readable, amount vs item left, date, vendor, duplicates, first-time limit. */
export function checkReceipt(f: Finance, r: Omit<Reimbursement, "id" | "check" | "status" | "submittedAt">, today = new Date().toISOString().slice(0, 10)): ReceiptCheck {
  const ref = findItem(f.categories, r.itemId);
  const checks: ReceiptCheck["checks"] = [];
  const name = r.receiptName.toLowerCase();
  checks.push(!name ? { label: "Readable", result: "fail", detail: "No receipt attached" } : /statement|screenshot|bank/.test(name) ? { label: "Readable", result: "warn", detail: "Card statement or screenshot, not an itemized receipt" } : /\.(pdf|png|jpe?g|heic)$/.test(name) ? { label: "Readable", result: "pass", detail: "Receipt file attached" } : { label: "Readable", result: "warn", detail: "Unusual file type; check it by hand" });
  if (!ref) checks.push({ label: "Budget item", result: "fail", detail: "Pick the budget item this came out of" });
  else {
    const onItem = ref.item.allocated > 0;
    const left = onItem ? ref.item.allocated - ref.item.spent : categoryTotals(ref.category).left;
    const where = onItem ? ref.item.name : ref.category.name;
    checks.push(r.amount <= left ? { label: "Within budget", result: "pass", detail: `${money(left)} left on ${where}` } : { label: "Within budget", result: "warn", detail: `${money(r.amount)} is ${money(r.amount - left)} over what's left on ${where}` });
    checks.push(!ref.item.vendor || ref.item.vendor === "TBD" || related(ref.item.vendor, r.vendor) ? { label: "Vendor matches", result: "pass", detail: `Receipt vendor "${r.vendor}"` } : { label: "Vendor matches", result: "warn", detail: `Budget item vendor is ${ref.item.vendor}, receipt says ${r.vendor}` });
  }
  const days = (Date.parse(today) - Date.parse(r.purchaseDate)) / 86400000;
  checks.push(!r.purchaseDate || isNaN(days) ? { label: "Date", result: "fail", detail: "Missing purchase date" } : days < 0 ? { label: "Date", result: "fail", detail: "Purchase date is in the future" } : days > 60 ? { label: "Date", result: "warn", detail: `${Math.round(days)} days old (policy: 60)` } : { label: "Date", result: "pass", detail: `Bought ${r.purchaseDate}` });
  const dup = f.reimbursements.find((x) => x.status !== "Denied" && ((name && x.receiptName.toLowerCase() === name) || (x.amount === r.amount && x.purchaseDate === r.purchaseDate && related(x.vendor, r.vendor))));
  checks.push(dup ? { label: "No duplicates", result: "fail", detail: `Same receipt or amount + date + vendor as ${dup.id}` } : { label: "No duplicates", result: "pass", detail: "No earlier request with this file or amount + date + vendor" });
  if (r.firstReimbursement && r.amount > 500) checks.push({ label: "First-time limit", result: "warn", detail: "First reimbursement over $500: confirm the payee's identity" });
  const verdict: CheckResult = checks.some((c) => c.result === "fail") ? "fail" : checks.some((c) => c.result === "warn") ? "warn" : "pass";
  return { verdict, checks };
}

export function submitReimbursement(f: Finance, r: Omit<Reimbursement, "id" | "check" | "status" | "submittedAt">): Finance {
  if (!r.name.trim() || !(r.amount > 0)) throw new Error("Name and a positive amount are required");
  const check = checkReceipt(f, r);
  const x: Reimbursement = { ...r, id: newId("R"), submittedAt: new Date().toISOString(), check, status: check.verdict === "fail" ? "Waiting on finance" : "Waiting on finance" };
  return log({ ...f, reimbursements: [x, ...f.reimbursements] }, r.email || r.name, "Reimbursement submitted", x.id, `${money(r.amount)} · ${r.vendor} · receipt check ${check.verdict}`);
}

export function financeReview(f: Finance, id: string, status: "Approved" | "Rejected" | "Needs Info", role: Role, actor: string, notes?: string): Finance {
  guard(role, "finance.review");
  const r = f.reimbursements.find((x) => x.id === id);
  if (!r || r.status !== "Waiting on finance") throw new Error("Not waiting on finance");
  if (status === "Approved" && r.check.verdict === "fail") throw new Error("Receipt check failed; reject it or ask for info");
  const next: ReimbursementStatus = status === "Approved" ? "Ready for director" : status === "Rejected" ? "Denied" : "Waiting on finance";
  return log({ ...f, reimbursements: f.reimbursements.map((x) => (x.id === id ? { ...x, status: next, financeNotes: notes || x.financeNotes } : x)) }, actor, `Finance ${status === "Approved" ? "approved" : `marked ${status}`}`, id, notes);
}

export function directorDecide(f: Finance, id: string, approve: boolean, role: Role, actor: string): Finance {
  guard(role, "director.decide");
  const r = f.reimbursements.find((x) => x.id === id);
  if (!r || r.status !== "Ready for director") throw new Error("Not ready for the director");
  const paid = approve && r.payee;
  const paymentId = `PAY-${Math.floor(10000 + Math.random() * 89999)}`;
  let next: Finance = {
    ...f,
    reimbursements: f.reimbursements.map((x) => (x.id === id ? { ...x, director: actor, status: !approve ? "Denied" : paid ? "Paid" : "Approved – payment pending", paymentId: paid ? paymentId : undefined, paidAt: paid ? new Date().toISOString() : undefined } : x)),
    categories: paid ? mapItems(f.categories, (i) => (i.id === r.itemId ? { ...i, spent: i.spent + r.amount } : i)) : f.categories,
  };
  next = log(next, actor, approve ? "Director approved" : "Director denied", id);
  if (paid) next = log(next, "Payments (simulated)", "Payment sent", id, `${money(r.amount)} to ${r.name} · ${paymentId}`);
  else if (approve) next = log(next, "Payments (simulated)", "Payment waiting", id, `${r.name} isn't set up as a payee yet`);
  return next;
}

export function markReimbursementPaid(f: Finance, id: string, role: Role, actor: string): Finance {
  guard(role, "finance.review");
  const r = f.reimbursements.find((x) => x.id === id);
  if (!r || r.status !== "Approved – payment pending") throw new Error("Not awaiting payment");
  const paymentId = `PAY-${Math.floor(10000 + Math.random() * 89999)}`;
  return log({ ...f, reimbursements: f.reimbursements.map((x) => (x.id === id ? { ...x, status: "Paid", payee: true, paymentId, paidAt: new Date().toISOString() } : x)), categories: mapItems(f.categories, (i) => (i.id === r.itemId ? { ...i, spent: i.spent + r.amount } : i)) }, actor, "Payment sent", id, `${money(r.amount)} to ${r.name} · ${paymentId} (simulated)`);
}

const contingencyItem = (f: Finance) => f.categories.filter((c) => /contingency|buffer|reserve/i.test(c.name)).flatMap(itemsOf)[0];

/** Suggested decision: budget-neutral moves are approved; otherwise fund from contingency in full, partially (≥ minimum), or deny. */
export function suggest(f: Finance, r: Pick<BudgetRequest, "itemId" | "fromItemId" | "amount" | "minAmount" | "urgency" | "neededBy">): BudgetRequest["suggestion"] {
  const target = findItem(f.categories, r.itemId);
  const reasoning: string[] = [];
  if (!target) return { decision: "Deny", amount: 0, reasoning: ["The budget item doesn't exist"] };
  const t = categoryTotals(target.category);
  reasoning.push(`${target.category.name} has ${money(t.left)} left of ${money(t.allocated)}`);
  const source = r.fromItemId ? findItem(f.categories, r.fromItemId) : undefined;
  const pool = source ? source.item.allocated - source.item.actualCost : (() => { const c = contingencyItem(f); return c ? c.allocated - c.spent : 0; })();
  reasoning.push(source ? `Moving from ${itemPath(source)}: ${money(pool)} not yet committed there` : `Contingency available: ${money(pool)}`);
  if (/High|Critical/.test(r.urgency)) reasoning.push(`${r.urgency} urgency, needed by ${r.neededBy}`);
  if (pool >= r.amount) return { decision: "Approve", amount: r.amount, reasoning: [...reasoning, source ? "Budget-neutral move" : "Fits in contingency"] };
  if (r.minAmount && pool >= r.minAmount) return { decision: "Partial", amount: Math.floor(pool), reasoning: [...reasoning, `Covers more than the ${money(r.minAmount)} minimum`] };
  return { decision: "Deny", amount: 0, reasoning: [...reasoning, "Not enough uncommitted money; cut scope or find a sponsor"] };
}

export function submitRequest(f: Finance, r: Omit<BudgetRequest, "id" | "submittedAt" | "suggestion" | "status">): Finance {
  if (!(r.amount > 0) || !findItem(f.categories, r.itemId)) throw new Error("Pick a budget item and a positive amount");
  const x: BudgetRequest = { ...r, id: newId("B"), submittedAt: new Date().toISOString(), suggestion: suggest(f, r), status: "Waiting on director" };
  return log({ ...f, requests: [x, ...f.requests] }, r.name, "Budget request submitted", x.id, `${money(r.amount)} · suggested ${x.suggestion.decision}`);
}

export function decideRequest(f: Finance, id: string, decision: Decision, amount: number, role: Role, actor: string): Finance {
  guard(role, "director.decide");
  const r = f.requests.find((x) => x.id === id);
  if (!r || r.status !== "Waiting on director") throw new Error("Not waiting on the director");
  const granted = decision === "Deny" ? 0 : Math.max(0, Math.min(amount, r.amount));
  let next: Finance = log({ ...f, requests: f.requests.map((x) => (x.id === id ? { ...x, status: decision === "Deny" ? "Denied" : granted < x.amount ? "Partially approved" : "Approved", approvedAmount: granted, director: actor } : x)) }, actor, decision === "Deny" ? "Director denied" : `Director approved ${money(granted)}`, id);
  if (granted > 0) {
    const target = findItem(f.categories, r.itemId)!;
    const source = r.fromItemId ? findItem(f.categories, r.fromItemId) : (() => { const c = contingencyItem(f); return c ? findItem(f.categories, c.id) : undefined; })();
    const sameCat = source?.category.id === target.category.id;
    next = {
      ...next,
      categories: mapItems(
        next.categories.map((c) => (sameCat ? c : c.id === target.category.id ? { ...c, allocated: c.allocated + granted } : c.id === source?.category.id ? { ...c, allocated: c.allocated - granted } : c)),
        (i) => (i.id === target.item.id ? { ...i, allocated: i.allocated + granted } : i.id === source?.item.id ? { ...i, allocated: i.allocated - granted } : i),
      ),
    };
    next = log(next, "EventPilot", "Budget updated", target.item.id, `${itemPath(target)} +${money(granted)}${source ? `, ${itemPath(source)} −${money(granted)}` : ""}`);
  }
  return next;
}

export function updateItem(f: Finance, id: string, patch: Partial<Omit<BudgetItem, "id">>, role: Role, actor: string): Finance {
  guard(role, "budget.edit");
  const ref = findItem(f.categories, id);
  if (!ref) throw new Error("Item not found");
  if ((["allocated", "actualCost", "spent"] as const).some((k) => patch[k] !== undefined && !(Number.isFinite(patch[k]) && patch[k]! >= 0))) throw new Error("Amounts must be 0 or more");
  const changes = (["allocated", "actualCost", "spent"] as const).filter((k) => patch[k] !== undefined && patch[k] !== ref.item[k]).map((k) => `${k} ${money(ref.item[k])} → ${money(patch[k]!)}`);
  return log({ ...f, categories: mapItems(f.categories, (i) => (i.id === id ? { ...i, ...patch, source: i.source === "autopilot" ? "manual" : i.source } : i)) }, actor, "Budget item edited", id, `${itemPath(ref)}${changes.length ? ` · ${changes.join(", ")}` : ""}`);
}

export function addItem(f: Finance, categoryId: string, item: Omit<BudgetItem, "id">, role: Role, actor: string): Finance {
  guard(role, "budget.edit");
  if (!item.name.trim()) throw new Error("Enter an item name");
  const c = f.categories.find((x) => x.id === categoryId);
  if (!c) throw new Error("Category not found");
  const created = { ...item, id: newId("ITEM"), source: "manual" };
  return log({ ...f, categories: f.categories.map((x) => (x.id === categoryId ? { ...x, subcategories: x.subcategories.length ? x.subcategories.map((s, i) => (i === 0 ? { ...s, items: [...s.items, created] } : s)) : [{ id: `${x.id}-VENDORS`, name: "Vendors", items: [created] }] } : x)) }, actor, "Budget item added", created.id, `${c.name} › ${created.name} · ${money(created.allocated)}`);
}

export function setMemberRole(f: Finance, email: string, role: Role, actorRole: Role, actor: string): Finance {
  guard(actorRole, "access.manage");
  const m = f.members.find((x) => x.email === email);
  if (!m) throw new Error("Member not found");
  if (m.role === "Admin" && role !== "Admin" && f.members.filter((x) => x.role === "Admin").length === 1) throw new Error("Keep at least one Admin");
  return log({ ...f, members: f.members.map((x) => (x.email === email ? { ...x, role } : x)) }, actor, `Changed role to ${role}`, email, `was ${m.role}`);
}

export function addMember(f: Finance, email: string, name: string, role: Role, actorRole: Role, actor: string): Finance {
  guard(actorRole, "access.manage");
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Enter a valid email");
  if (f.members.some((m) => m.email === e)) throw new Error("That email already has access");
  return log({ ...f, members: [...f.members, { email: e, name: name.trim() || e.split("@")[0], role }] }, actor, `Granted ${role} access`, e);
}

/** Short text for Photon (FINANCE). */
export function financeText(plan: EventPlan): string {
  const f = syncFinance(plan);
  const t = budgetTotals(f.categories);
  const fin = f.reimbursements.filter((r) => r.status === "Waiting on finance").length;
  const dir = f.reimbursements.filter((r) => r.status === "Ready for director").length + f.requests.filter((r) => r.status === "Waiting on director").length;
  const over = f.categories.map((c) => ({ c, t: categoryTotals(c) })).filter((x) => x.t.actualCost > x.t.allocated);
  return [`Finance · ${plan.brief.title}`, `${money(t.spent)} spent, ${money(t.actualCost)} committed of ${money(t.allocated)}.`, over.length ? `Over budget: ${over.map((x) => `${x.c.name} (${money(x.t.actualCost - x.t.allocated)} over)`).join(", ")}.` : "No category is over budget.", `${fin} reimbursement${fin === 1 ? "" : "s"} waiting on finance, ${dir} waiting on the director.`].join("\n");
}
