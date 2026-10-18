import type { EventPlan } from "./types";

/** Day-of operations, ported from Gatherly (cal-hacks-gatherly/ops.py): run-of-show console, incident routing,
 * tiered payment approvals, sponsor deliverables, prizes, shipments, meal deliveries, headcount, nudges, attention feed, post-mortem.
 * Pure functions over plan.dayops; times are event-local "YYYY-MM-DDTHH:mm" strings. */

export type RosKind = "meal" | "ceremony" | "workshop" | "deadline" | "logistics" | "activity";
export type RosStatus = "planned" | "live" | "done" | "delayed" | "cancelled";
export type RosItem = { id: number; day: number; startsAt: string; endsAt: string; location: string; title: string; kind: RosKind; lead: string; status: RosStatus; delayMin: number };
export type Announcement = { id: number; sendAt: string; channel: "app"; text: string; rosId?: number; status: "scheduled" | "sent" };
export type IncidentCategory = "medical" | "security" | "conduct" | "facilities" | "lost_found" | "other";
export type Severity = "low" | "medium" | "high" | "critical";
export type Incident = {
  id: number; category: IncidentCategory; severity: Severity; location: string; description: string; reportedBy: string; owner: string;
  status: "open" | "acknowledged" | "resolved"; createdAt: string; events: { at: string; actor: string; action: string; note: string }[];
};
export type PaymentRequest = { id: number; source: string; payee: string; amount: number; requestedBy: string; status: "pending" | "approved" | "rejected" | "paid"; approvals: { by: string; at: string }[] };
export type Deliverable = { id: number; sponsor: string; tier: string; kind: string; description: string; status: "todo" | "done" | "n/a"; dueAt: string; owner: string };
export type PrizeStatus = "unassigned" | "winner_selected" | "tax_form_sent" | "shipped" | "delivered";
export type Prize = { id: number; category: string; prize: string; budget: number; winnerTeam?: string; status: PrizeStatus; tracking?: string };
export type Shipment = { id: number; item: string; vendor: string; arriveBy: string; status: "Ordered" | "Shipped" | "Delivered"; poc: string };
export type MealOrder = { id: number; meal: string; scheduledAt: string; quantity: number; split: Record<string, number>; vendor: string; confirmedAt?: string; confirmedBy?: string; eta?: string; needsReschedule: boolean; status: "Scheduled" | "Payment Needed" | "Completed" };
export type Nudge = { id: number; audience: "all" | "solo" | "unchecked_in"; text: string; sendAt?: string; status: "scheduled" | "queued"; announcementId?: number };
export type OpsLog = { at: string; actor: string; action: string; detail: string };
export type DayOps = {
  version: 1;
  ros: RosItem[]; announcements: Announcement[]; incidents: Incident[]; payments: PaymentRequest[]; deliverables: Deliverable[];
  prizes: Prize[]; shipments: Shipment[]; meals: MealOrder[]; nudges: Nudge[];
  attendees: { registered: number; checkedIn: number; firstTimers: number; solo: number; teams: number; dietary: Record<string, number>; synthetic: true };
  routing: Record<IncidentCategory, string>; organizers: string[]; director: string; log: OpsLog[];
};
export type Alert = { severity: Severity; title: string; detail: string; area: "logistics" | "money" | "incidents" | "sponsors" | "prizes" | "schedule"; ref: string };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pad = (n: number) => String(n).padStart(2, "0");
export const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s);
export const addMin = (s: string, m: number) => localIso(new Date(toDate(s).getTime() + m * 60000));
const nowIso = () => localIso(new Date());
const nextId = <T extends { id: number }>(xs: T[]) => xs.reduce((m, x) => Math.max(m, x.id), 0) + 1;

export const CATEGORIES: IncidentCategory[] = ["medical", "security", "conduct", "facilities", "lost_found", "other"];
export const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

export function kindOf(title: string): RosKind {
  const l = title.toLowerCase();
  if (/breakfast|lunch|dinner|snack|brunch|meal|midnight/.test(l)) return "meal";
  if (/ceremony|opening|closing|awards|keynote/.test(l)) return "ceremony";
  if (/workshop|talk|panel/.test(l)) return "workshop";
  if (/submission|judging|deadline|demo/.test(l)) return "deadline";
  if (/bus|check-?in|set-?up|clean-?up|sleep|shower|load|teardown|doors/.test(l)) return "logistics";
  return "activity";
}

/** Gatherly approval tiers: ≤$500 one organizer, ≤$5,000 two organizers, above that the event director. */
export function approvalRule(amount: number): { count: number; director: boolean; label: string } {
  if (amount <= 500) return { count: 1, director: false, label: "1 organizer" };
  if (amount <= 5000) return { count: 2, director: false, label: "2 organizers" };
  return { count: 1, director: true, label: "event director" };
}

export function seedDayOps(plan: EventPlan): DayOps {
  const b = plan.brief;
  const venue = plan.venues[plan.selectedVenue]?.name ?? "Main hall";
  const lead = (s: string) => s.replace(/\s+agent$/i, "");
  const ros: RosItem[] = [...plan.schedule]
    .map((s, i) => {
      const startsAt = addMin(`${b.date}T${s.time.padStart(5, "0")}`, ((s.day ?? 1) - 1) * 1440);
      return { id: i + 1, day: s.day ?? 1, startsAt, endsAt: addMin(startsAt, s.durationMin || 30), location: venue, title: s.title, kind: kindOf(s.title), lead: lead(s.owner ?? "Program"), status: "planned" as RosStatus, delayMin: 0 };
    })
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    .map((r, i) => ({ ...r, id: i + 1 }));
  const announcements: Announcement[] = ros
    .filter((r) => r.kind !== "activity" && r.kind !== "logistics")
    .map((r, i) => ({ id: i + 1, sendAt: addMin(r.startsAt, -15), channel: "app", text: `${r.title} starts in 15 minutes at ${r.location}.`, rosId: r.id, status: "scheduled" }));
  const ap = plan.autopilot;
  const vendorFor = (re: RegExp) => {
    const t = ap?.threads?.find((x) => re.test(x.category) && (x.status === "booked" || x.status === "agreed")) ?? ap?.threads?.find((x) => re.test(x.category));
    if (t) return t.vendor;
    const sl = ap?.shortlists?.find((x) => re.test(x.category));
    return sl ? sl.quotes[sl.pick].vendor : plan.vendors.find((v) => re.test(v.category))?.suggestion ?? "Caterer TBD";
  };
  const caterer = vendorFor(/food|cater/i);
  const meals: MealOrder[] = (plan.ops?.meals ?? []).map((m, i) => ({
    id: i + 1, meal: m.slot, scheduledAt: addMin(`${b.date}T${m.time.padStart(5, "0")}`, (m.day - 1) * 1440), quantity: m.servings, split: m.split, vendor: caterer, needsReschedule: false, status: "Scheduled",
  }));
  const split = plan.ops?.meals[0]?.split ?? {};
  const totalSplit = Object.values(split).reduce((s, n) => s + n, 0) || 1;
  const dietary = Object.fromEntries(Object.entries(split).filter(([k]) => !/standard|regular|omni/i.test(k)).map(([k, n]) => [k, Math.round((n / totalSplit) * b.guests)]));
  const contacts = plan.ops?.contacts ?? [];
  const owner = (re: RegExp, fallback: string) => contacts.find((c) => re.test(c.role))?.owner ?? fallback;
  const director = owner(/director|lead organizer|event lead|host/i, "Event lead");
  const routing: Record<IncidentCategory, string> = {
    medical: owner(/medic|emt|safety/i, "Safety lead"), security: owner(/secur|safety/i, "Safety lead"), conduct: owner(/safety|conduct/i, "Safety lead"),
    facilities: owner(/venue|facilit/i, "Venue lead"), lost_found: owner(/check-?in|info/i, "Check-in lead"), other: director,
  };
  const organizers = [...new Set([director, ...Object.values(routing), "Finance lead", "Logistics lead"])];
  const due = (days: number) => addMin(`${b.date}T${b.startTime.padStart(5, "0")}`, -days * 1440);
  const deliverables: Deliverable[] = [];
  for (const s of plan.ops?.sponsors ?? []) {
    for (let k = 1; k <= Math.min(s.count, 3); k++) {
      const name = `${s.tier} sponsor ${k}`;
      const kinds: [string, string, number][] = [["logo", "Logo on site, slides and T-shirt", 14], ["social", "Announcement post on socials", 7], ["booth", "Table and power at the venue", 1]];
      if (/gold|platinum|title|premier|diamond/i.test(s.tier)) kinds.push(["prize", "Sponsor prize track announced at opening", 0]);
      for (const [kind, description, d] of kinds) deliverables.push({ id: deliverables.length + 1, sponsor: name, tier: s.tier, kind, description, status: "todo", dueAt: due(d), owner: "Sponsorship" });
    }
  }
  const prizeLine = plan.budget.find((l) => /prize/i.test(l.category))?.amount ?? 0;
  const prizes: Prize[] = prizeLine
    ? ([["Grand prize", 0.4], ["Second place", 0.25], ["Third place", 0.15], ["Best beginner hack", 0.1], ["Best use of AI", 0.1]] as const).map(([c, f], i) => ({ id: i + 1, category: c, prize: `${c} (${money(prizeLine * f)})`, budget: Math.round(prizeLine * f), status: "unassigned" }))
    : [];
  const shippable = [...(ap?.shortlists ?? []).map((s) => ({ category: s.category, vendor: s.quotes[s.pick].vendor })), ...(ap?.threads ?? []).map((t) => ({ category: t.category, vendor: t.vendor }))]
    .filter((x, i, xs) => /swag|merch|print|suppl|decor|gift|prize|av|equip/i.test(x.category) && xs.findIndex((y) => y.category === x.category) === i);
  const shipments: Shipment[] = shippable.map((x, i) => ({ id: i + 1, item: x.category, vendor: x.vendor, arriveBy: due(2), status: "Ordered", poc: "Logistics lead" }));
  const payments: PaymentRequest[] = (ap?.threads ?? [])
    .filter((t) => t.status === "booked" && t.agreed)
    .map((t, i) => {
      const dep = ap?.purchases.find((p) => p.id === t.purchaseId)?.amount ?? 0;
      return { id: i + 1, source: `${t.category} balance`, payee: t.vendor, amount: Math.max(0, (t.agreed ?? 0) - dep), requestedBy: "Finance", status: "pending" as const, approvals: [] };
    })
    .filter((p) => p.amount > 0);
  return {
    version: 1, ros, announcements, incidents: [], payments, deliverables, prizes, shipments, meals, nudges: [],
    attendees: { registered: b.guests, checkedIn: 0, firstTimers: Math.round(b.guests * 0.35), solo: Math.round(b.guests * 0.2), teams: Math.round((b.guests * 0.8) / 4), dietary, synthetic: true },
    routing, organizers, director, log: [{ at: nowIso(), actor: "EventPilot", action: "seeded", detail: `Day-of ops built from the plan: ${ros.length} run-of-show items, ${meals.length} meals, ${deliverables.length} sponsor deliverables, ${prizes.length} prizes` }],
  };
}

export const dayOpsOf = (plan: EventPlan): DayOps => plan.dayops ?? seedDayOps(plan);
const logged = (o: DayOps, actor: string, action: string, detail: string): DayOps => ({ ...o, log: [{ at: nowIso(), actor, action, detail }, ...o.log].slice(0, 300) });
const req = (actor: string) => {
  if (!actor.trim()) throw new Error("Who is doing this? A name is required.");
  return actor.trim();
};

export function rosNow(o: DayOps, now: string) {
  const live = o.ros.filter((r) => r.status !== "cancelled" && r.status !== "done" && r.startsAt <= now && now < r.endsAt).map((r) => r.id);
  const next = o.ros.filter((r) => r.startsAt > now && r.status !== "cancelled").slice(0, 5).map((r) => r.id);
  return { live, next };
}

export function setRosStatus(o: DayOps, id: number, status: RosStatus, actor: string): DayOps {
  const r = o.ros.find((x) => x.id === id);
  if (!r) throw new Error("Run-of-show item not found");
  return logged({ ...o, ros: o.ros.map((x) => (x.id === id ? { ...x, status } : x)) }, req(actor), "ros_status", `${r.title} → ${status}`);
}

/** Gatherly's shift: move one item, everything after it at the same location, or the rest of the day; linked announcements move too and meal orders get flagged for the vendor. */
export function shiftSchedule(o: DayOps, id: number, minutes: number, scope: "item" | "location" | "day", actor: string) {
  const target = o.ros.find((x) => x.id === id);
  if (!target) throw new Error("Run-of-show item not found");
  if (!Number.isInteger(minutes) || minutes === 0) throw new Error("Minutes must be a non-zero whole number");
  const hit = (r: RosItem) => (scope === "item" ? r.id === id : r.day === target.day && r.startsAt >= target.startsAt && (scope === "day" || r.location === target.location));
  const moved = o.ros.filter(hit);
  const ids = new Set(moved.map((r) => r.id));
  const meals = new Set<number>();
  const mealsNext = o.meals.map((m) => {
    const r = moved.find((x) => x.kind === "meal" && x.startsAt === m.scheduledAt);
    if (!r) return m;
    meals.add(m.id);
    return { ...m, scheduledAt: addMin(m.scheduledAt, minutes), needsReschedule: true, confirmedAt: undefined };
  });
  const next: DayOps = {
    ...o,
    ros: o.ros.map((r) => (ids.has(r.id) ? { ...r, startsAt: addMin(r.startsAt, minutes), endsAt: addMin(r.endsAt, minutes), delayMin: r.delayMin + minutes, status: minutes > 0 && r.status === "planned" ? "delayed" : r.status } : r)),
    announcements: o.announcements.map((a) => (a.rosId && ids.has(a.rosId) ? { ...a, sendAt: addMin(a.sendAt, minutes) } : a)),
    meals: mealsNext,
  };
  const out = logged(next, req(actor), "ros_shift", `Shifted ${scope === "item" ? target.title : `${scope} from ${target.title}`} by ${minutes > 0 ? "+" : ""}${minutes} min (${moved.length} items${meals.size ? `, ${meals.size} meal order${meals.size > 1 ? "s" : ""} need the vendor told` : ""})`);
  return { ops: out, shifted: moved.length, mealsFlagged: [...meals] };
}

export function reportIncident(o: DayOps, x: { category: IncidentCategory; severity: Severity; description: string; location?: string; reportedBy: string }) {
  if (!CATEGORIES.includes(x.category)) throw new Error("Invalid incident category");
  if (!SEVERITIES.includes(x.severity)) throw new Error("Invalid severity");
  if (!x.description.trim()) throw new Error("Describe what happened");
  const at = nowIso();
  const owner = o.routing[x.category];
  const note = `Routed to ${owner}${x.severity === "critical" ? `; escalated to ${o.director}` : ""}`;
  const inc: Incident = { id: nextId(o.incidents), category: x.category, severity: x.severity, location: x.location?.trim() || "Unspecified", description: x.description.trim(), reportedBy: req(x.reportedBy), owner, status: "open", createdAt: at, events: [{ at, actor: x.reportedBy, action: "opened", note }] };
  return { ops: logged({ ...o, incidents: [inc, ...o.incidents] }, x.reportedBy, "incident_opened", `${x.severity} ${x.category.replace("_", " ")} #${inc.id}: ${note}`), incident: inc };
}

export function updateIncident(o: DayOps, id: number, patch: { status?: Incident["status"]; owner?: string; note?: string }, actor: string): DayOps {
  const inc = o.incidents.find((x) => x.id === id);
  if (!inc) throw new Error("Incident not found");
  const status = patch.status ?? inc.status;
  const ev = { at: nowIso(), actor: req(actor), action: status !== inc.status ? `→ ${status}` : "updated", note: patch.note?.trim() ?? "" };
  return logged({ ...o, incidents: o.incidents.map((x) => (x.id === id ? { ...x, status, owner: patch.owner || x.owner, events: [...x.events, ev] } : x)) }, actor, "incident_updated", `#${id} ${status}`);
}

export function paymentAction(o: DayOps, id: number, action: "approve" | "reject" | "mark-paid", actor: string, reason = ""): DayOps {
  const p = o.payments.find((x) => x.id === id);
  if (!p) throw new Error("Payment request not found");
  const by = req(actor);
  if (!o.organizers.includes(by)) throw new Error("Unknown organizer");
  let next: PaymentRequest;
  if (action === "approve") {
    if (p.status !== "pending") throw new Error("Payment request is not pending");
    if (p.approvals.some((a) => a.by === by)) throw new Error(`${by} already approved this`);
    const approvals = [...p.approvals, { by, at: nowIso() }];
    const rule = approvalRule(p.amount);
    const ok = rule.director ? approvals.some((a) => a.by === o.director) : new Set(approvals.map((a) => a.by)).size >= rule.count;
    next = { ...p, approvals, status: ok ? "approved" : "pending" };
  } else if (action === "reject") {
    if (p.status !== "pending") throw new Error("Payment request is not pending");
    next = { ...p, status: "rejected" };
  } else {
    if (p.status !== "approved") throw new Error("Approve before marking paid");
    next = { ...p, status: "paid" };
  }
  const detail = `${p.payee} ${money(p.amount)}: ${action === "mark-paid" ? "marked paid (recorded only, no money moved)" : next.status === "approved" ? "fully approved" : action === "approve" ? `approval ${next.approvals.length}/${approvalRule(p.amount).count}` : `rejected${reason ? `: ${reason}` : ""}`}`;
  return logged({ ...o, payments: o.payments.map((x) => (x.id === id ? next : x)) }, by, `payment_${action}`, detail);
}

export function setDeliverable(o: DayOps, id: number, status: Deliverable["status"], actor: string): DayOps {
  const d = o.deliverables.find((x) => x.id === id);
  if (!d) throw new Error("Deliverable not found");
  return logged({ ...o, deliverables: o.deliverables.map((x) => (x.id === id ? { ...x, status } : x)) }, req(actor), "deliverable", `${d.sponsor} ${d.kind} → ${status}`);
}

export function updatePrize(o: DayOps, id: number, patch: { status?: PrizeStatus; winnerTeam?: string; tracking?: string }, actor: string): DayOps {
  const p = o.prizes.find((x) => x.id === id);
  if (!p) throw new Error("Prize not found");
  const status = patch.status ?? p.status;
  if (status !== "unassigned" && !(patch.winnerTeam ?? p.winnerTeam)) throw new Error("Pick the winning team first");
  return logged({ ...o, prizes: o.prizes.map((x) => (x.id === id ? { ...x, ...patch, status } : x)) }, req(actor), "prize", `${p.category} → ${status.replace(/_/g, " ")}`);
}

export function confirmMeal(o: DayOps, id: number, actor: string, eta?: string): DayOps {
  const m = o.meals.find((x) => x.id === id);
  if (!m) throw new Error("Meal order not found");
  return logged({ ...o, meals: o.meals.map((x) => (x.id === id ? { ...x, confirmedAt: nowIso(), confirmedBy: actor, eta, needsReschedule: false } : x)) }, req(actor), "meal_confirmed", `${m.vendor} confirmed ${m.meal}${eta ? ` (ETA ${eta})` : ""}`);
}

export function setShipment(o: DayOps, id: number, status: Shipment["status"], actor: string): DayOps {
  const s = o.shipments.find((x) => x.id === id);
  if (!s) throw new Error("Shipment not found");
  return logged({ ...o, shipments: o.shipments.map((x) => (x.id === id ? { ...x, status } : x)) }, req(actor), "shipment", `${s.item} → ${status}`);
}

export function checkIn(o: DayOps, count: number, actor: string): DayOps {
  if (!Number.isInteger(count) || count < 0) throw new Error("Count must be a whole number");
  const left = o.attendees.registered - o.attendees.checkedIn;
  if (count > left) throw new Error(`Only ${left} people are left to check in`);
  return logged({ ...o, attendees: { ...o.attendees, checkedIn: o.attendees.checkedIn + count } }, req(actor), "checkin", `+${count} checked in (${o.attendees.checkedIn + count}/${o.attendees.registered})`);
}

/** Expected attendance: actual check-ins once doors open, else a 55% show rate (Gatherly's default); meals flagged short <95% or over >115%. */
export function headcount(o: DayOps) {
  const { registered, checkedIn, dietary } = o.attendees;
  const expected = checkedIn > 0 ? checkedIn : Math.round(registered * 0.55);
  return {
    registered, checkedIn, expected, showRate: 0.55,
    meals: o.meals.map((m) => ({ id: m.id, meal: m.meal, quantity: m.quantity, delta: m.quantity - expected, dietary, flag: m.quantity < expected * 0.95 ? "short" : m.quantity > expected * 1.15 ? "over" : "ok" })),
  };
}

export function generateNudges(o: DayOps, now: string, actor: string) {
  const fresh: Nudge[] = [];
  let id = nextId(o.nudges);
  for (const a of o.announcements)
    if (a.status === "scheduled" && a.sendAt >= now && !o.nudges.some((n) => n.announcementId === a.id)) fresh.push({ id: id++, audience: "all", text: a.text, sendAt: a.sendAt, status: "scheduled", announcementId: a.id });
  const mixer = o.ros.find((r) => /team formation|mixer|team/i.test(r.title));
  if (o.attendees.solo > 0 && !o.nudges.some((n) => n.audience === "solo"))
    fresh.push({ id: id++, audience: "solo", text: mixer ? `Looking for a team? ${mixer.title} at ${mixer.startsAt.slice(11)} in ${mixer.location}.` : "Looking for a team? Find organizers at the info desk.", status: "scheduled" });
  if (o.attendees.checkedIn < o.attendees.registered && !o.nudges.some((n) => n.audience === "unchecked_in"))
    fresh.push({ id: id++, audience: "unchecked_in", text: `Check-in is open at ${o.ros[0]?.location ?? "the main entrance"}. Bring your ID.`, status: "scheduled" });
  const out = fresh.length ? logged({ ...o, nudges: [...o.nudges, ...fresh] }, req(actor), "nudges_generated", `${fresh.length} attendee nudges drafted`) : o;
  return { ops: out, created: fresh.length };
}

export function queueNudge(o: DayOps, id: number, actor: string): DayOps {
  const n = o.nudges.find((x) => x.id === id);
  if (!n) throw new Error("Nudge not found");
  return logged({ ...o, nudges: o.nudges.map((x) => (x.id === id ? { ...x, status: "queued" } : x)) }, req(actor), "nudge_queued", `Queued for ${n.audience.replace("_", " ")} (attendee messaging is simulated)`);
}

export function alerts(o: DayOps, now: string, eventStart: string, eventEnd: string): Alert[] {
  const out: Alert[] = [];
  const soon = addMin(now, 24 * 60);
  for (const m of o.meals) {
    if (m.scheduledAt >= now && m.scheduledAt <= soon && !m.confirmedAt) out.push({ severity: "high", title: "Vendor confirmation", detail: `${m.meal} (${m.vendor}) is within 24 hours and not confirmed`, area: "logistics", ref: `meal-${m.id}` });
    if (m.needsReschedule) out.push({ severity: "high", title: "Meal reschedule", detail: `${m.meal} moved; tell ${m.vendor} the new time`, area: "logistics", ref: `meal-${m.id}` });
    if (m.status === "Payment Needed") out.push({ severity: "medium", title: "Payment needed", detail: `Payment is needed for ${m.meal}`, area: "money", ref: `meal-${m.id}` });
  }
  for (const s of o.shipments) if (s.status !== "Delivered" && now > s.arriveBy) out.push({ severity: s.arriveBy < eventStart ? "medium" : "high", title: "Late shipment", detail: `${s.item} from ${s.vendor} was due ${s.arriveBy.replace("T", " ")}`, area: "logistics", ref: `ship-${s.id}` });
  for (const p of o.payments) if (p.status === "pending") out.push({ severity: "medium", title: "Payment approval", detail: `${p.payee} ${money(p.amount)} needs ${approvalRule(p.amount).label} (${p.approvals.length} so far)`, area: "money", ref: `pay-${p.id}` });
  for (const i of o.incidents) if (i.status !== "resolved" && (i.severity === "high" || i.severity === "critical")) out.push({ severity: i.severity, title: `${i.severity} ${i.category.replace("_", " ")} incident`, detail: `${i.description} · ${i.owner}`, area: "incidents", ref: `inc-${i.id}` });
  const in48 = addMin(now, 48 * 60);
  for (const d of o.deliverables) if (d.status === "todo" && d.dueAt <= in48) out.push({ severity: d.dueAt < now ? "high" : "medium", title: d.dueAt < now ? "Sponsor deliverable overdue" : "Sponsor deliverable due soon", detail: `${d.sponsor}: ${d.description}`, area: "sponsors", ref: `del-${d.id}` });
  if (now > eventEnd) for (const p of o.prizes) if (p.status === "unassigned") out.push({ severity: "low", title: "Prize winner not assigned", detail: p.prize, area: "prizes", ref: `prize-${p.id}` });
  for (const h of headcount(o).meals) if (h.flag === "short") out.push({ severity: "medium", title: "Meal count short", detail: `${h.meal}: ${h.quantity} ordered vs ${headcount(o).expected} expected`, area: "logistics", ref: `meal-${h.id}` });
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}

export function eventWindow(plan: EventPlan) {
  const start = `${plan.brief.date}T${plan.brief.startTime.padStart(5, "0")}`;
  return { start, end: addMin(start, Math.round(plan.brief.durationHours * 60)) };
}

export function postmortem(plan: EventPlan, o: DayOps): string {
  const a = plan.autopilot;
  const committed = (a?.purchases ?? []).filter((p) => ["auto_approved", "approved"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  const paid = o.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const byCat = o.incidents.reduce<Record<string, number>>((m, i) => ({ ...m, [i.category]: (m[i.category] ?? 0) + 1 }), {});
  const delayed = o.ros.filter((r) => r.delayMin > 0);
  const prizeBy = o.prizes.reduce<Record<string, number>>((m, p) => ({ ...m, [p.status]: (m[p.status] ?? 0) + 1 }), {});
  return [
    `# ${plan.brief.title} post-mortem`,
    "",
    `- Generated: ${nowIso().replace("T", " ")}`,
    `- Spend: ${money(committed)} committed by Autopilot, ${money(paid)} in balances marked paid, against a ${money(plan.brief.budget)} budget.`,
    `- Attendance: ${o.attendees.checkedIn} checked in of ${o.attendees.registered} registered (${Math.round((100 * o.attendees.checkedIn) / Math.max(1, o.attendees.registered))}%).`,
    `- Meals: ${o.meals.length} orders, ${o.meals.filter((m) => m.confirmedAt).length} vendor-confirmed.`,
    `- Incidents: ${o.incidents.length} total (${Object.entries(byCat).map(([k, n]) => `${k.replace("_", " ")} ${n}`).join(", ") || "none"}); ${o.incidents.filter((i) => i.status !== "resolved").length} open.`,
    `- Schedule: ${o.ros.length} items, ${delayed.length} delayed, ${delayed.reduce((s, r) => s + r.delayMin, 0)} minutes of total delay.`,
    `- Sponsor deliverables: ${o.deliverables.filter((d) => d.status === "done").length} done, ${o.deliverables.filter((d) => d.status === "todo").length} still to do.`,
    `- Prizes: ${o.prizes.length} total (${Object.entries(prizeBy).map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ") || "none"}).`,
    `- Vendor threads: ${(a?.threads ?? []).length}; booked ${(a?.threads ?? []).filter((t) => t.status === "booked").length}.`,
    "",
    "## Next time",
    ...(delayed.length ? [`- Add buffer before ${delayed[0].title}; it slipped ${delayed[0].delayMin} min.`] : []),
    ...(o.incidents.some((i) => i.category === "medical") ? ["- Keep the EMT post next to the main hall; medical calls came up."] : []),
    ...(o.attendees.checkedIn && o.attendees.checkedIn < o.attendees.registered * 0.5 ? ["- Show rate was under 50%: order meals for check-ins, not registrations."] : []),
    "- Re-use this plan as the starting template; vendors that booked are pre-filled.",
  ].join("\n");
}

/** Short text for Photon (ATTENTION). */
export function attentionText(plan: EventPlan, now = nowIso()): string {
  const o = dayOpsOf(plan);
  const w = eventWindow(plan);
  const xs = alerts(o, now, w.start, w.end);
  const live = rosNow(o, now).live.map((id) => o.ros.find((r) => r.id === id)!.title);
  return [`Day-of ops · ${plan.brief.title}`, live.length ? `Happening now: ${live.join(", ")}.` : "", xs.length ? `Needs attention:\n${xs.slice(0, 6).map((x) => `• ${x.title}: ${x.detail}`).join("\n")}` : "Nothing needs attention.", "Text INCIDENT <medical|security|facilities|...> <what happened> or DELAY <item> <minutes>."].filter(Boolean).join("\n");
}
