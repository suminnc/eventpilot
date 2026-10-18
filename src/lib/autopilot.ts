import type { AuditEntry, Autopilot, EventPlan, OutboxMessage, Purchase, SpendMandate } from "./types";

/**
 * Autopilot: turns a plan into executed actions (outreach + guarded purchases).
 * Payments are SIMULATED — no real card network calls. The guardrails (mandate, step-up approval,
 * idempotency keys, single-use virtual cards, hash-chained audit log) are real and enforced here.
 */

export function defaultMandate(plan: EventPlan): SpendMandate {
  const b = plan.brief.budget;
  const contingency = plan.budget.find((l) => /contingency/i.test(l.category))?.amount ?? 0;
  return {
    totalCap: b - contingency,
    perPurchaseCap: Math.round(b * 0.3),
    approvalThreshold: Math.max(250, Math.round(b * 0.02)),
    allowedCategories: Array.from(new Set(["Venue", ...plan.vendors.map((v) => v.category)])),
  };
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

export function appendAudit(log: AuditEntry[], actor: string, action: string, detail: string): AuditEntry[] {
  const prev = log[log.length - 1]?.hash ?? "00000000";
  const ts = Date.now();
  return [...log, { ts, actor, action, detail, prev, hash: fnv(`${prev}|${ts}|${actor}|${action}|${detail}`) }];
}

export function verifyAudit(log: AuditEntry[]): boolean {
  return log.every((e, i) => e.prev === (i ? log[i - 1].hash : "00000000") && e.hash === fnv(`${e.prev}|${e.ts}|${e.actor}|${e.action}|${e.detail}`));
}

const virtualCard = () => `Visa •••• ${String(Math.floor(1000 + Math.random() * 9000))}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function committed(purchases: Purchase[]) {
  return purchases.filter((p) => p.status === "auto_approved" || p.status === "approved" || p.status === "pending").reduce((s, p) => s + p.amount, 0);
}

export function evaluate(m: SpendMandate, p: Omit<Purchase, "status" | "reason" | "card">, spent: number): Pick<Purchase, "status" | "reason"> {
  if (!m.allowedCategories.includes(p.category)) return { status: "blocked", reason: `Category “${p.category}” is not in the mandate allowlist` };
  if (p.amount > m.perPurchaseCap) return { status: "blocked", reason: `${money(p.amount)} exceeds per-purchase cap ${money(m.perPurchaseCap)}` };
  if (spent + p.amount > m.totalCap) return { status: "blocked", reason: `Would exceed total cap ${money(m.totalCap)}` };
  if (p.amount > m.approvalThreshold) return { status: "pending", reason: `Over ${money(m.approvalThreshold)} — needs human approval` };
  return { status: "auto_approved", reason: `Within mandate (≤ ${money(m.approvalThreshold)})` };
}

export type AutopilotStep = { label: string; apply: (a: Autopilot, plan: EventPlan) => { a: Autopilot; plan: EventPlan } };

/** Builds the ordered list of actions the Autopilot will take; the UI plays them back one by one. */
export function planSteps(plan: EventPlan, mandate: SpendMandate): AutopilotStep[] {
  const b = plan.brief;
  const venue = plan.venues[plan.selectedVenue];
  const findTask = (re: RegExp) => plan.tasks.find((t) => re.test(t.title))?.id;
  const steps: AutopilotStep[] = [];

  const msg = (m: Omit<OutboxMessage, "id" | "status">, actor: string): AutopilotStep => ({
    label: `${actor}: draft ${m.channel} to ${m.to}`,
    apply: (a, p) => ({
      a: { ...a, outbox: [...a.outbox, { ...m, id: `m${a.outbox.length}`, status: "draft" }], audit: appendAudit(a.audit, actor, "draft_message", `${m.channel} → ${m.to}: ${m.subject}`) },
      plan: p,
    }),
  });

  const buy = (vendor: string, category: string, purpose: string, amount: number, taskRe?: RegExp): AutopilotStep => ({
    label: `Payments: request ${money(amount)} ${purpose.toLowerCase()} for ${vendor}`,
    apply: (a, p) => {
      const base = { id: `p${a.purchases.length}`, idempotencyKey: `${p.id.slice(0, 8)}-${fnv(vendor + purpose)}`, vendor, category, purpose, amount: Math.round(amount), ts: Date.now() };
      if (a.purchases.some((x) => x.idempotencyKey === base.idempotencyKey)) return { a, plan: p };
      const verdict = evaluate(a.mandate, base, committed(a.purchases));
      const purchase: Purchase = { ...base, ...verdict, card: verdict.status === "auto_approved" ? virtualCard() : undefined };
      let tasks = p.tasks;
      const tid = taskRe && p.tasks.find((t) => taskRe.test(t.title))?.id;
      if (tid && verdict.status === "auto_approved") tasks = tasks.map((t) => (t.id === tid ? { ...t, done: true } : t));
      return {
        a: { ...a, purchases: [...a.purchases, purchase], audit: appendAudit(a.audit, "payments", verdict.status, `${vendor} ${money(base.amount)} — ${verdict.reason}`) },
        plan: { ...p, tasks },
      };
    },
  });

  steps.push({
    label: `Payments: load spend mandate (cap ${money(mandate.totalCap)}, approve > ${money(mandate.approvalThreshold)})`,
    apply: (a, p) => ({ a: { ...a, audit: appendAudit(a.audit, "organizer", "set_mandate", JSON.stringify(mandate)) }, plan: p }),
  });

  if (venue) {
    steps.push(
      msg(
        {
          channel: "email",
          to: `events@${slug(venue.name)}.com`,
          subject: `Hold request: ${b.title} on ${b.date}`,
          body: `Hello ${venue.name} events team,\n\nWe'd like to place a hold for ${b.title} on ${b.date} from ${b.startTime} for ${b.durationHours} hours, ${b.guests.toLocaleString()} guests.\nRequirements: ${b.constraints.join(", ") || "standard AV, Wi-Fi"}.\n\nCould you share availability, a quote, and your deposit terms?\n\nThanks!`,
          taskId: findTask(/hold on|venue/i),
        },
        "scout",
      ),
    );
    const venueLine = plan.budget.find((l) => l.category === "Venue")?.amount ?? venue.pricePerHour * b.durationHours;
    steps.push(buy(venue.name, "Venue", "Venue deposit (30%)", venueLine * 0.3, /hold on/i));
  }

  for (const v of plan.vendors) {
    steps.push(
      msg(
        {
          channel: "email",
          to: `${v.category.toLowerCase().replace(/\W+/g, "")}-vendors@rfq.eventpilot.app`,
          subject: `RFQ: ${v.category} for ${b.title} (${b.guests.toLocaleString()} guests, ${b.date})`,
          body: `Hi,\n\nWe're sourcing ${v.suggestion.toLowerCase()} for ${b.title} in ${b.city} on ${b.date}.\nTarget budget: ${money(v.estCost)}. ${v.contactTip}\n\nPlease reply with a quote and availability within 48 hours.`,
          taskId: findTask(new RegExp(v.category, "i")),
        },
        "logistics",
      ),
    );
    steps.push(buy(`${v.category} vendor`, v.category, `${v.category} deposit (25%)`, v.estCost * 0.25, new RegExp(`Book AV|${v.category}`, "i")));
  }

  steps.push(
    msg({ channel: "email", to: "guest-list", subject: plan.invite.subject, body: plan.invite.body, taskId: findTask(/save-the-date|registration/i) }, "comms"),
    msg({ channel: "sms", to: "guest-list (T-3 days)", subject: "Reminder", body: plan.invite.sms, taskId: findTask(/reminder/i) }, "comms"),
  );
  return steps;
}

export function emptyAutopilot(mandate: SpendMandate): Autopilot {
  return { mandate, purchases: [], outbox: [], audit: [] };
}

export function decide(plan: EventPlan, id: string, approve: boolean): EventPlan {
  const a = plan.autopilot!;
  const p = a.purchases.find((x) => x.id === id);
  if (!p || p.status !== "pending") return plan;
  const updated: Purchase = approve ? { ...p, status: "approved", card: virtualCard(), reason: "Approved by organizer (step-up)" } : { ...p, status: "rejected", reason: "Rejected by organizer" };
  return {
    ...plan,
    autopilot: { ...a, purchases: a.purchases.map((x) => (x.id === id ? updated : x)), audit: appendAudit(a.audit, "organizer", approve ? "approve" : "reject", `${p.vendor} ${money(p.amount)}`) },
  };
}

export function sendMessage(plan: EventPlan, id: string): EventPlan {
  const a = plan.autopilot!;
  const m = a.outbox.find((x) => x.id === id);
  if (!m || m.status === "sent") return plan;
  return {
    ...plan,
    tasks: m.taskId ? plan.tasks.map((t) => (t.id === m.taskId ? { ...t, done: true } : t)) : plan.tasks,
    autopilot: { ...a, outbox: a.outbox.map((x) => (x.id === id ? { ...x, status: "sent" } : x)), audit: appendAudit(a.audit, "organizer", "send_message", `${m.channel} → ${m.to}`) },
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
