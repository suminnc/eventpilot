import { seedDayOps } from "./dayops";
import { syncFinance } from "./finance";
import type { AuditEntry, Autopilot, EventBrief, EventPlan, OutboxMessage, Purchase, Quote, Round, Shortlist, SpendMandate, Vendor } from "./types";

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
    allowedCategories: Array.from(new Set(["Venue", ...plan.vendors.map((v) => v.category), ...(plan.permits?.length ? ["Permits"] : []), ...(plan.ops ? ["Staffing"] : [])])),
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

export const virtualCard = () => `Visa •••• ${String(Math.floor(1000 + Math.random() * 9000))}`;
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
/** awaitVendors: real email mode, so vendor deposits wait until the vendor confirms a price by email. */
export function planSteps(plan: EventPlan, mandate: SpendMandate, opts: { awaitVendors?: boolean } = {}): AutopilotStep[] {
  const b = plan.brief;
  const venue = plan.venues[plan.selectedVenue];
  const findTask = (re: RegExp) => plan.tasks.find((t) => re.test(t.title))?.id;
  const steps: AutopilotStep[] = [];

  const msg = (m: Omit<OutboxMessage, "id" | "status">, actor: string): AutopilotStep => ({
    label: `${actor}: draft ${m.channel} to ${m.to}`,
    apply: (a, p) =>
      a.outbox.some((x) => x.to === m.to && (x.subject === m.subject || m.to.startsWith("bookings@"))) ? { a, plan: p } : ({
      a: { ...a, outbox: [...a.outbox, { ...m, id: `m${a.outbox.length}`, status: "draft" }], audit: appendAudit(a.audit, actor, "draft_message", `${m.channel} → ${m.to}: ${m.subject}`) },
      plan: p,
    }),
  });

  const buy = (vendor: string, category: string, purpose: string, amount: number, taskRe?: RegExp, why?: string): AutopilotStep => ({
    label: `Payments: request ${money(amount)} ${purpose.toLowerCase()} for ${vendor}`,
    apply: (a, p) => {
      const base = { id: `p${a.purchases.length}`, idempotencyKey: `${p.id.slice(0, 8)}-${fnv(vendor + purpose)}`, vendor, category, purpose, amount: Math.round(amount), ts: Date.now(), why };
      if (a.purchases.some((x) => x.category === category && x.purpose === purpose && x.status !== "blocked")) return { a, plan: p };
      const verdict = evaluate(a.mandate, base, committed(a.purchases));
      if (verdict.status === "blocked" && a.purchases.some((x) => x.category === category && x.purpose === purpose)) return { a, plan: p };
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
    apply: (a, p) => ({ a: { ...a, mandate, audit: appendAudit(a.audit, "organizer", "set_mandate", JSON.stringify(mandate)) }, plan: p }),
  });

  if (venue) {
    steps.push(
      msg(
        {
          channel: "email",
          to: `events@${slug(venue.name)}.com`,
          subject: `Hold request: ${b.title} on ${b.date}`,
          body: `Hello ${venue.name} events team,\n\nWe'd like to place a hold for ${b.title} on ${b.date} from ${b.startTime} for ${b.durationHours} hours, ${b.guests.toLocaleString()} guests.\nRequirements: ${b.constraints.join(", ") || "standard AV, Wi-Fi"}.\n\nCould you share availability, a quote, and your deposit terms? We'd also like to book two walkthroughs: one about 8 weeks out for the floorplan, and a final one about 2 weeks before the event.\n\nThanks!`,
          taskId: findTask(/hold on|venue/i),
        },
        "scout",
      ),
    );
    const venueLine = plan.budget.find((l) => l.category === "Venue")?.amount ?? venue.pricePerHour * b.durationHours;
    if (!opts.awaitVendors) steps.push(buy(venue.name, "Venue", "Venue deposit (30%)", venueLine * 0.3, /hold on/i));
  }

  const vendors = tidyVendors(plan.vendors, !!venue);
  for (const v of vendors) {
    const listed = shortlist(b, v.category, v.estCost);
    const sl = negotiateShortlist(b, listed);
    const q = sl.quotes[sl.pick];
    const haggled = sl.quotes.filter((x) => x.rounds);
    steps.push({
      label: `Shopper: compared ${listed.quotes.length} ${v.category} quotes → ${listed.quotes[listed.pick].vendor} (${money(listed.quotes[listed.pick].price)} list)`,
      apply: (a, p) =>
        a.shortlists?.some((x) => x.category === v.category) ? { a, plan: p } : ({
        a: { ...a, shortlists: [...(a.shortlists ?? []), listed], audit: appendAudit(a.audit, "shopper", "shortlist", `${v.category}: ${listed.why}`) },
        plan: p,
      }),
    });
    steps.push({
      label: `Negotiator: haggled with ${haggled.length} ${v.category} vendors → ${q.vendor} ${money(q.price)}${q.listPrice && q.listPrice > q.price ? ` (saved ${money(q.listPrice - q.price)})` : ""}`,
      apply: (a, p) => {
        const cur = a.shortlists?.find((x) => x.category === v.category);
        if (cur?.negotiated || a.purchases.some((x) => x.category === v.category && LIVE.includes(x.status))) return { a, plan: p };
        const detail = `${v.category}: ${haggled.map((x) => `${x.vendor} ${money(x.listPrice!)}→${money(x.price)}`).join("; ")}. Pick: ${q.vendor}.`;
        return { a: { ...a, shortlists: [...(a.shortlists ?? []).filter((x) => x.category !== v.category), sl], audit: appendAudit(a.audit, "negotiator", "negotiate", detail) }, plan: p };
      },
    });
    const book = msg(
        {
          channel: "email",
          to: `bookings@${slug(q.vendor)}.com`,
          subject: `Booking: ${v.category} for ${b.title} (${b.guests.toLocaleString()} guests, ${b.date})`,
          body: opts.awaitVendors
            ? `Hi ${q.vendor} team,\n\nWe're organizing ${b.title} in ${b.city} on ${b.date} (${b.startTime}, ${b.durationHours}h, ${b.guests.toLocaleString()} guests) and would like to book ${v.suggestion.toLowerCase()}.\n${v.contactTip}\n\nOur budget for this is ${money(q.price)}, in line with the other quotes we've received. Can you confirm availability at that price, and your deposit terms? We cap deposits at 50%.${q.price >= 20000 ? "\nFor a contract this size we also need written performance terms (service levels, what's included, remedies if it falls short)." : ""}\n\nThanks!`
            : `Hi ${q.vendor} team,\n\nWe'd like to book ${v.suggestion.toLowerCase()} for ${b.title} in ${b.city} on ${b.date}, at the ${money(q.price)} we agreed${q.listPrice && q.listPrice > q.price ? ` (down from your ${money(q.listPrice)} list price)` : ""}.\n${v.contactTip}\n\nWe'll pay a 25% deposit by virtual card today. Please confirm availability and send your contract.`,
          taskId: findTask(new RegExp(v.category, "i")),
        },
        "logistics",
    );
    steps.push({ ...book, apply: (a, p) => (a.shortlists?.find((x) => x.category === v.category)?.pick === sl.pick ? book.apply(a, p) : { a, plan: p }) });
    if (!opts.awaitVendors) steps.push(buy(q.vendor, v.category, `${v.category} deposit (25%)`, q.price * 0.25, new RegExp(`Book AV|${v.category}`, "i"), sl.why));
  }

  const ops = plan.ops;
  if (ops) {
    const hrs = b.durationHours;
    const guards = ops.staffing.find((x) => /security/i.test(x.role))?.count ?? 0;
    if (guards && !vendors.some((v) => /secur/i.test(v.category))) steps.push(buy("Licensed security contractor", "Staffing", "Security deposit (25%)", guards * hrs * 55 * 0.25, /security guards/i, `${guards} guards × ${hrs}h at ~$55/h`));
    const medic = ops.staffing.find((x) => /emt/i.test(x.role));
    if (medic) steps.push(buy("Event medical services", "Staffing", "EMT coverage deposit (25%)", medic.count * Math.min(hrs, 12) * 120 * 0.25, /emt|first aid/i, `${medic.count} EMT shifts × ${Math.min(hrs, 12)}h at ~$120/h`));
    const sponsorTask = plan.tasks.find((t) => /close sponsors/i.test(t.title))?.id;
    for (const t of ops.sponsors.slice(0, 3)) {
      steps.push(
        msg(
          {
            channel: "email",
            to: `${t.tier.toLowerCase()}-prospects (list)`,
            subject: `${b.title}: ${t.tier} sponsorship ($${t.price.toLocaleString()})`,
            body: `Hi {first_name},\n\n${b.title} brings ${b.guests.toLocaleString()} builders together on ${b.date} in ${b.city}. Our ${t.tier} package ($${t.price.toLocaleString()}) includes: ${t.perks}.\n\nWe have ${t.count} ${t.tier} slot${t.count > 1 ? "s" : ""}. Could we find 20 minutes this week?\n\nThanks!`,
            taskId: sponsorTask,
          },
          "comms",
        ),
      );
    }
  }

  for (const pm of plan.permits ?? []) {
    steps.push(
      msg(
        {
          channel: "email",
          to: pm.agency,
          subject: `${pm.atRisk ? "EXPEDITED " : ""}Permit application: ${pm.name} for ${b.title} (${b.date})`,
          body: `Hello,\n\nWe're applying for a ${pm.name.toLowerCase()} for ${b.title} at ${venue?.name ?? "our venue"}, ${b.city}, on ${b.date} from ${b.startTime} (${b.durationHours}h), ${b.guests.toLocaleString()} attendees.\nReason: ${pm.why}.\n${pm.atRisk ? `We're inside your usual ${pm.leadDays}-day lead time. Is expedited review possible?\n` : ""}Attached: floor plan, run-of-show, certificate of insurance.\n\nPlease let us know of any additional requirements.`,
          taskId: pm.taskId,
        },
        "permits",
      ),
    );
    if (pm.fee > 0) steps.push(buy(pm.agency, "Permits", `Permit fee: ${pm.name}`, pm.fee, undefined, `Filing fee (estimate) for ${pm.name}`));
  }

  steps.push(
    msg({ channel: "email", to: "guest-list", subject: plan.invite.subject, body: plan.invite.body, taskId: findTask(/save-the-date|registration/i) }, "comms"),
    msg({ channel: "email", to: "guest-list", subject: `Attendee guide: ${b.title}`, body: `Hi {first_name},\n\nHere's everything you need for ${b.title} on ${b.date} at ${venue?.name ?? b.city}.\n\nSchedule:\n${plan.schedule.slice(0, 12).map((s) => `${plan.schedule.some((x) => (x.day ?? 1) > 1) ? `Day ${s.day ?? 1} ` : ""}${s.time}  ${s.title}`).join("\n")}\n\nDoors open at ${b.startTime}.${b.guests >= 150 ? " Bring a photo ID for check-in." : ""}${plan.ops?.policies.length ? `\nPlease read our policies: ${plan.ops.policies.map((x) => x.name).join(", ")}.` : ""}\n\nSee you there!`, taskId: findTask(/guide|logistics email|day-of info/i) }, "comms"),
    msg({ channel: "sms", to: "guest-list (T-3 days)", subject: "Reminder", body: plan.invite.sms, taskId: findTask(/reminder/i) }, "comms"),
  );
  steps.push(
    {
      label: "Finance: master budget built (categories → vendor items, allocated / committed / spent)",
      apply: (a, p) => {
        const finance = syncFinance({ ...p, autopilot: a });
        return { a: { ...a, audit: appendAudit(a.audit, "finance", "master_budget", `${finance.categories.length} categories; reimbursements and budget requests open`) }, plan: { ...p, finance } };
      },
    },
    {
      label: "Logistics: day-of ops ready (run of show, meal deliveries, shipments, sponsor deliverables, prizes, incident routing)",
      apply: (a, p) => {
        const dayops = p.dayops ?? seedDayOps({ ...p, autopilot: a });
        return { a: { ...a, audit: appendAudit(a.audit, "logistics", "dayops_ready", `${dayops.ros.length} run-of-show items, ${dayops.meals.length} meals, ${dayops.shipments.length} shipments, ${dayops.deliverables.length} sponsor deliverables`) }, plan: { ...p, dayops } };
      },
    },
  );
  return steps;
}

export function emptyAutopilot(mandate: SpendMandate): Autopilot {
  return { mandate, purchases: [], outbox: [], audit: [], shortlists: [] };
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

/** Drafts Autopilot may send on its own: vendor/venue emails and permit filings. Guest-list and sponsor mass mailings wait for the organizer. */
export const isAutoDraft = (m: OutboxMessage) => m.status === "draft" && m.channel === "email" && (/^(bookings|events)@/.test(m.to) || /Permit application/.test(m.subject));

export function sendMessage(plan: EventPlan, id: string, actor = "organizer", note = ""): EventPlan {
  const a = plan.autopilot!;
  const m = a.outbox.find((x) => x.id === id);
  if (!m || m.status === "sent") return plan;
  return {
    ...plan,
    tasks: m.taskId ? plan.tasks.map((t) => (t.id === m.taskId ? { ...t, done: true } : t)) : plan.tasks,
    autopilot: { ...a, outbox: a.outbox.map((x) => (x.id === id ? { ...x, status: "sent" } : x)), audit: appendAudit(a.audit, actor, "send_message", `${m.channel} → ${m.to}${note}`) },
  };
}

const MERCHANTS: Record<string, [string, string[]][]> = {
  Catering: [
    ["Golden Gate Banquets", ["high-volume", "buffet lines"]],
    ["Mission Street Kitchens", ["halal", "vegan", "gluten-free", "vegetarian"]],
    ["Bay Leaf Catering Co.", ["farm-to-table", "vegetarian"]],
    ["Sunset Halal Grill", ["halal", "high-volume"]],
    ["Green Fork Collective", ["vegan", "vegetarian", "gluten-free"]],
    ["Off the Grid Food Trucks", ["variety", "vegetarian", "budget"]],
  ],
  AV: [
    ["Bay Pro Staging", ["stage", "livestream"]],
    ["SoundCheck AV", ["wi-fi", "budget"]],
    ["Lumen Event Tech", ["livestream", "lighting", "wi-fi"]],
    ["MeshNet Event Wi-Fi", ["wi-fi", "power"]],
    ["Presidio Audio Visual", ["stage", "lighting"]],
    ["Hackbox Rentals", ["power", "wi-fi", "budget"]],
  ],
  Photography: [
    ["Fogline Studio", ["photo", "video"]],
    ["Shutter & Co.", ["photo", "budget"]],
    ["Pixel Pier Media", ["video", "same-day edits"]],
    ["Campus Lens Collective", ["photo", "budget"]],
    ["Northbeach Films", ["video", "aftermovie"]],
    ["Candid Cable Car", ["photo", "same-day edits"]],
  ],
  Swag: [
    ["UltraPress Apparel", ["shirts", "high-volume"]],
    ["Jukebox Print", ["stickers", "signage", "budget"]],
    ["Wizard Pins", ["pins"]],
    ["Bay Merch Works", ["shirts", "totes", "budget"]],
    ["Fresh Prints Custom", ["shirts", "high-volume"]],
    ["Golden Bear Promo", ["bottles", "totes"]],
  ],
  Staffing: [
    ["Pinnacle Event Security", ["licensed", "crowd management"]],
    ["Bay Guard Services", ["licensed", "budget"]],
    ["Civic Event Staffing", ["ushers", "check-in"]],
    ["Sentinel Protective Group", ["licensed", "overnight"]],
    ["Crowd Control Pros", ["crowd management", "overnight"]],
    ["Campus Crew Staffing", ["check-in", "budget"]],
  ],
  Marketing: [
    ["Precision Graphics", ["banners", "signage"]],
    ["Jukebox Signage", ["signage", "budget"]],
    ["Fog City Print Shop", ["posters", "budget"]],
    ["Social Spark Studio", ["social", "video"]],
    ["Bay Area Event Promo", ["social", "email"]],
    ["Market Street Printing", ["banners", "posters"]],
  ],
  Prizes: [
    ["Tango Rewards", ["gift cards"]],
    ["Seeed Studio Store", ["hardware"]],
    ["B&H Photo Corporate", ["hardware", "cameras"]],
    ["Giftbit", ["gift cards", "budget"]],
    ["Adafruit Industries", ["hardware", "budget"]],
    ["Bambu Lab Education", ["3d printers"]],
  ],
  Rentals: [
    ["Canopy & Co.", ["tents", "heaters"]],
    ["Party Rental Depot", ["budget"]],
    ["Elevate Rentals", ["ada", "accessible", "tents"]],
    ["Bay Area Tent Works", ["tents"]],
    ["Fog City Furniture", ["seating", "tables"]],
    ["AccessAble Event Supply", ["ada", "accessible"]],
  ],
};
function merchantsFor(category: string) {
  const c = category.toLowerCase();
  const key = /cater|food|meal|drink|snack/.test(c) ? "Catering" : /\bav\b|wi-?fi|audio|network|power|tech/.test(c) ? "AV" : /photo|video|film/.test(c) ? "Photography"
    : /swag|merch|shirt/.test(c) ? "Swag" : /secur|staff/.test(c) ? "Staffing" : /market|print|signage|promo/.test(c) ? "Marketing" : /prize|award/.test(c) ? "Prizes" : /rental|tent|furniture/.test(c) ? "Rentals" : "";
  return MERCHANTS[key];
}

/** One entry per category, no venue (Scout books it) and no contingency (not a vendor). Merges model-generated duplicates. */
export function tidyVendors(vendors: Vendor[], hasVenue: boolean): Vendor[] {
  const out: Vendor[] = [];
  for (const v of vendors) {
    const c = v.category.trim();
    if ((hasVenue && /^venue/i.test(c)) || /contingency|buffer|reserve|permit|insurance/i.test(c)) continue;
    const same = out.find((x) => x.category.toLowerCase() === c.toLowerCase());
    if (same) Object.assign(same, { estCost: same.estCost + v.estCost, suggestion: `${same.suggestion}; ${v.suggestion}` });
    else out.push({ ...v, category: c });
  }
  return out;
}

const SHAPES = [
  { mult: 1.0, rating: 4.6, leadDays: 5, cancellable: true },
  { mult: 0.84, rating: 4.1, leadDays: 12, cancellable: false },
  { mult: 1.17, rating: 4.8, leadDays: 3, cancellable: true },
  { mult: 0.93, rating: 4.4, leadDays: 4, cancellable: true },
  { mult: 1.08, rating: 4.7, leadDays: 7, cancellable: false },
  { mult: 0.76, rating: 3.9, leadDays: 2, cancellable: false },
];

const daysUntil = (date: string) => Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000);

/** Discovery + decision: gathers every comparable quote (5–6) for a category and picks one, scored against the brief. */
export function shortlist(brief: EventBrief, category: string, target: number): Shortlist {
  const names = merchantsFor(category) ?? ([["Bay Area {c} Co.", []], ["{c} Collective", ["budget"]], ["Premier {c}", []], ["Golden Gate {c}", []], ["{c} Express", []], ["Mission {c} Works", ["budget"]]] as [string, string[]][]).map(([n, t]) => [n.replace("{c}", category.split(/\s*[&/,]\s*/)[0] || category), t] as [string, string[]]);
  const quotes: Quote[] = names.map(([vendor, tags], i) => {
    const sh = SHAPES[(i + fnv(category).charCodeAt(0)) % SHAPES.length];
    return { vendor, tags, price: Math.round((target * sh.mult) / 50) * 50, rating: sh.rating, leadDays: sh.leadDays, cancellable: sh.cancellable };
  });
  return { category, target, quotes, ...choose(brief, target, quotes) };
}

function choose(brief: EventBrief, target: number, quotes: Quote[]): Pick<Shortlist, "pick" | "why"> {
  const needs = `${brief.constraints.join(" ")} ${brief.vibe}`.toLowerCase();
  const days = daysUntil(brief.date);
  const scored = quotes.map((q) => {
    const fit = q.tags.filter((t) => needs.includes(t.split(" ")[0]));
    const late = days < q.leadDays;
    const delta = (q.price - target) / Math.max(1, target);
    const score = q.rating * 10 - delta * 40 + fit.length * 6 + (q.cancellable ? 4 : 0) - (late ? 60 : 0);
    return { q, fit, late, delta, score };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const pick = scored.indexOf(best);
  for (const s of scored) {
    s.q.note = s.late ? `Needs ${s.q.leadDays} days lead time; your event is in ${Math.max(0, days)}` : s.fit.length ? `Matches: ${s.fit.join(", ")}` : undefined;
  }
  const reasons = [
    best.fit.length ? `matches your ${best.fit.join(", ")} needs` : "",
    Math.abs(best.delta) < 0.03 ? `on the ${money(target)} target` : best.delta < 0 ? `${Math.round(-best.delta * 100)}% under the ${money(target)} target` : `${Math.round(best.delta * 100)}% over target, worth it for the fit`,
    `${best.q.rating}★`,
    best.q.cancellable ? "free cancellation" : "",
  ].filter(Boolean);
  const cheaper = scored.find((s) => s !== best && s.q.price < best.q.price);
  const tradeoff = cheaper ? ` ${cheaper.q.vendor} was ${money(best.q.price - cheaper.q.price)} cheaper but ${cheaper.late ? "can't deliver in time" : cheaper.q.cancellable ? "rated lower" : "has no cancellation window"}.` : "";
  return { pick, why: `Picked ${best.q.vendor}: ${reasons.join(", ")}.${tradeoff}` };
}

const r50 = (n: number) => Math.round(n / 50) * 50;

/** One simulated vendor negotiation. Each demo vendor has a hidden floor (2–18% under list); the agent anchors low with competing quotes as leverage and never goes below the floor. */
function haggle(q: Quote, rival?: Quote): Quote {
  const list = q.price;
  const margin = Math.max(0.02, 0.05 + (parseInt(fnv(`${q.vendor}|floor`).slice(0, 4), 16) / 0xffff) * 0.13 - (q.rating >= 4.7 ? 0.03 : 0));
  const floor = r50(list * (1 - margin));
  const ask1 = r50(rival ? Math.max(rival.price, list * 0.8) : list * 0.85);
  const rounds: Round[] = [{ by: "agent", price: ask1, note: rival ? `Asked ${money(ask1)}, citing ${rival.vendor}'s ${money(rival.price)} quote` : `Asked ${money(ask1)} (15% off list)` }];
  let final = floor;
  if (floor <= ask1) {
    final = ask1;
    rounds.push({ by: "vendor", price: ask1, note: `Accepted ${money(ask1)}` });
  } else {
    const counter = r50(Math.max(floor, list - (list - ask1) * 0.4));
    if (counter <= floor) {
      rounds.push({ by: "vendor", price: floor, note: `Countered ${money(floor)}, best and final` }, { by: "agent", price: floor, note: `Accepted ${money(floor)}` });
    } else {
      const ask2 = r50((ask1 + counter) / 2);
      rounds.push({ by: "vendor", price: counter, note: `Countered ${money(counter)}` }, { by: "agent", price: ask2, note: `Offered ${money(ask2)} to meet in the middle` });
      if (floor <= ask2) {
        final = ask2;
        rounds.push({ by: "vendor", price: ask2, note: `Accepted ${money(ask2)}` });
      } else {
        rounds.push({ by: "vendor", price: floor, note: `Best and final: ${money(floor)}` }, { by: "agent", price: floor, note: `Accepted ${money(floor)}` });
      }
    }
  }
  return { ...q, listPrice: list, price: Math.min(final, list), rounds };
}

/** Negotiator: haggles with every vendor that can deliver in time, then re-picks on the negotiated prices (fit still counts, so it won't trade away diets or lead time for price). */
export function negotiateShortlist(brief: EventBrief, sl: Shortlist): Shortlist {
  if (sl.negotiated) return sl;
  const days = daysUntil(brief.date);
  const ok = (q: Quote) => days >= q.leadDays;
  const quotes = sl.quotes.map((q) => {
    if (!ok(q)) return q;
    const rival = sl.quotes.filter((x) => x !== q && ok(x) && x.price < q.price).sort((x, y) => x.price - y.price)[0];
    return haggle(q, rival);
  });
  const c = choose(brief, sl.target, quotes);
  const p = quotes[c.pick];
  const saved = p.listPrice ? p.listPrice - p.price : 0;
  return { ...sl, quotes, ...c, why: `${c.why}${saved > 0 ? ` Negotiated ${p.vendor} down from ${money(p.listPrice!)} to ${money(p.price)}, saving ${money(saved)}.` : ""}`, negotiated: true };
}

/** Total saved by negotiation on the current picks. */
export function negotiatedSavings(a: Autopilot): number {
  return (a.shortlists ?? []).reduce((s, sl) => {
    const q = sl.quotes[sl.pick];
    return s + (q.listPrice ? Math.max(0, q.listPrice - q.price) : 0);
  }, 0);
}

export const LIVE = ["auto_approved", "approved", "pending"];

/** Organizer overrides the agent's pick: cancels/refunds the old deposit and re-checks the new one against the mandate. */
export function switchQuote(plan: EventPlan, category: string, idx: number): EventPlan {
  const a = plan.autopilot!;
  const sl = a.shortlists?.find((s) => s.category === category);
  if (!sl || sl.pick === idx) return plan;
  const q = sl.quotes[idx];
  let purchases = a.purchases;
  let audit = appendAudit(a.audit, "organizer", "switch_vendor", `${category}: ${sl.quotes[sl.pick].vendor} → ${q.vendor}`);
  const old = purchases.find((p) => p.category === category && LIVE.includes(p.status));
  if (old) {
    const status = old.status === "pending" ? "canceled" : "refunded";
    purchases = purchases.map((p) => (p.id === old.id ? { ...p, status, reason: `${status === "refunded" ? "Refunded to card" : "Canceled"}: organizer switched vendor` } : p));
    audit = appendAudit(audit, "payments", status, `${old.vendor} ${money(old.amount)}`);
  }
  const purpose = `${category} deposit (25%)`;
  const base = { id: `p${purchases.length}`, idempotencyKey: `${plan.id.slice(0, 8)}-${fnv(q.vendor + purpose + purchases.length)}`, vendor: q.vendor, category, purpose, amount: Math.round(q.price * 0.25), ts: Date.now(), why: `Organizer chose ${q.vendor} over the agent's pick` };
  const v = evaluate(a.mandate, base, committed(purchases));
  purchases = [...purchases, { ...base, ...v, card: v.status === "auto_approved" ? virtualCard() : undefined }];
  audit = appendAudit(audit, "payments", v.status, `${q.vendor} ${money(base.amount)}: ${v.reason}`);
  const prev = slug(sl.quotes[sl.pick].vendor);
  const outbox = [
    ...a.outbox.filter((m) => m.status === "sent" || !m.to.includes(prev)),
    {
      id: `m${a.outbox.length}`,
      channel: "email" as const,
      to: `bookings@${slug(q.vendor)}.com`,
      subject: `Booking request: ${category} for ${plan.brief.title} (${plan.brief.date})`,
      body: `Hello ${q.vendor} team,\n\nWe'd like to book you for ${plan.brief.title} on ${plan.brief.date}, ${plan.brief.guests.toLocaleString()} guests, at your quoted ${money(q.price)}.\n${plan.brief.constraints.length ? `Requirements: ${plan.brief.constraints.join(", ")}.\n` : ""}Please confirm availability and send your contract and deposit terms.\n\nThanks!`,
      status: "draft" as const,
    },
  ];
  audit = appendAudit(audit, "shopper", "draft_message", `email → bookings@${slug(q.vendor)}.com`);
  return { ...plan, autopilot: { ...a, purchases, audit, outbox, shortlists: a.shortlists!.map((s) => (s === sl ? { ...s, pick: idx } : s)) } };
}

/** Post-purchase: refund a settled deposit back to its single-use card. */
export function refund(plan: EventPlan, id: string): EventPlan {
  const a = plan.autopilot!;
  const p = a.purchases.find((x) => x.id === id);
  if (!p || !p.card || (p.status !== "approved" && p.status !== "auto_approved")) return plan;
  return {
    ...plan,
    autopilot: {
      ...a,
      purchases: a.purchases.map((x) => (x.id === id ? { ...x, status: "refunded", reason: `Refunded to ${p.card}` } : x)),
      audit: appendAudit(a.audit, "organizer", "refund", `${p.vendor} ${money(p.amount)} → ${p.card}`),
    },
  };
}

export const slug = (s: string) => s.split(/\s+(?:at|@|-|–|\|)\s+|,/i)[0].toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "").slice(0, 30) || "vendor";
