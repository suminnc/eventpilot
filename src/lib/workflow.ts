import type { EventPlan } from "./types";
import {
  scaleOf,
  swarmRoles,
  swarmChecks,
  swarmCadence,
  swarmTrackers,
  SWARM_PHASES,
  type Scale,
  type SwarmPhase,
  type SwarmRole,
  type Check,
  type SwarmFlags,
} from "./swarm";

/**
 * Organizing workflow modelled on the subteam roles (see `swarm.ts`).
 * Teams and gates collapse with event size and type, and late gates are compressed into a catch-up plan.
 */

export { scaleOf };
export type { Scale, Check };

export type Team = SwarmRole;
export type GateStatus = "done" | "overdue" | "this_week" | "upcoming" | "past";
export type Gate = { id: string; tMinus: number; due: string; originalDue: string; title: string; owner: string; detail: string; status: GateStatus };
export type Workflow = { scale: Scale; teams: Team[]; phases: SwarmPhase[]; gates: Gate[]; cadence: string[]; trackers: string[]; checks: Check[]; guardrails: string[]; daysOut: number; compressed: number };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(new Date(`${date}T12:00:00`).getTime() + n * DAY));

type Tpl = { id: string; t: number; title: string; owner: string; detail: string; when?: (c: Ctx) => boolean; small?: string; skipSmall?: boolean };
type Ctx = { scale: Scale; hackathon: boolean; sponsors: boolean; permits: boolean; merch: boolean };
const big = (c: Ctx) => c.scale === "large" || c.scale === "medium";

// Offsets (days before the event) are the playbook's large-event timeline; smaller events scale them down.
// Owners are swarm roles — the Logistics lead's sub-agents, Finance, Sponsorship, Comms and Exec.
const GATES: Tpl[] = [
  { id: "venue-shortlist", t: 300, title: "Venue long list + phone screens", skipSmall: true, owner: "Venue & Services", detail: "4–6 candidates; screen capacity, overnight access, forced vendors, power/wifi, food policy, transit, loading, insurance" },
  { id: "venue-sign", t: 270, title: "Tour shortlist and sign the venue", small: "Book the venue", owner: "Exec", detail: "One tour each; score capacity, total cost incl. forced vendors, transit, power/wifi, vibe; Finance reviews deposits and cancellation" },
  { id: "sponsor-launch", t: 270, title: "Sponsorship launch", owner: "Sponsorship", detail: "Prospectus with tiers + à la carte, early-bird deadline; past sponsors first, then outbound", when: (c) => c.sponsors },
  { id: "budget-v1", t: 180, title: "Budget v1", small: "Set the budget", owner: "Finance", detail: "Category budgets from past actuals and committed sponsor total; a 10–15% contingency line; exec signs off" },
  { id: "services-rfq", t: 120, title: "Big services RFQ", owner: "Venue & Services", detail: "Wifi, power, A/V, furniture: one written spec to ≥5 vendors each; negotiate with competing quotes", when: big },
  { id: "services-choose", t: 90, title: "Choose big-service vendors", owner: "Venue & Services", detail: "Written quotes from ≥5 vendors on one spec, plus performance terms (bandwidth, AP count, usage graphs, remedies); deposits ≤50%", when: big },
  { id: "brand", t: 90, title: "Theme and brand locked", owner: "Merch & Gifts", detail: "Theme, fonts, colors; post a theme guide", when: big },
  { id: "merch-scope", t: 90, title: "Merch scoped + meals shortlisted", owner: "Merch & Gifts", detail: "Every item gets a tracker row with vendor spec and order-by; design request dates computed backward", when: (c) => c.merch },
  { id: "apps-open", t: 84, title: "Applications open", owner: "Comms", detail: "Hacker + judge/mentor/volunteer applications; MLH member-event application if partnering", when: (c) => c.hackathon },
  { id: "rsvp-open", t: 60, title: "Invites / registration open", owner: "Comms", detail: "Send invites or open registration; track RSVPs and dietary needs", when: (c) => !c.hackathon },
  { id: "meals-final", t: 70, title: "Meals finalized; long-lead merch ordered", owner: "Food", detail: "Individually packaged portions, ~25% vegetarian and 5% vegan/GF, delivered 30 min early, allergen info filed; call caterers for bulk discounts; sea freight needs ~25 days + customs", when: big },
  { id: "walkthrough-1", t: 56, title: "Walkthrough 1 + floorplan v1", owner: "Logistics Lead", detail: "Measure rooms, outlets/circuits, food lines, sleeping, booths, stage; decor rules", when: big },
  { id: "decisions", t: 42, title: "Priority deadline; decisions out", owner: "Comms", detail: "One-week confirmation window, reminder 48h before it closes", when: (c) => c.hackathon },
  { id: "sponsor-survey", t: 35, title: "Sponsor survey + judge/mentor deadline", owner: "Sponsorship", detail: "On-site names, parking, workshop times, prize tracks, email blurb", when: (c) => c.sponsors },
  { id: "orders", t: 28, title: "Orders and deposits", owner: "Finance", detail: "Domestic merch/print ordered, transport booked, wifi/power deposits, sponsor deliverables due" },
  { id: "permits", t: 21, title: "Permits filed / confirmed", owner: "Venue & Services", detail: "Fire/assembly, sound, food, insurance COI; expedite anything inside its lead time", when: (c) => c.permits },
  { id: "walkthrough-2", t: 14, title: "Final walkthrough + run-through", owner: "Exec", detail: "Final floorplan to fire marshal, event-day run-through, role guides sent", when: big },
  { id: "guide", t: 10, title: "Attendee guide + package audit", small: "Send guests the details (time, place, what to bring)", owner: "Comms", detail: "Guide with schedule, maps, channels; every shipment arrives ≥3 days before load-in" },
  { id: "confirm", t: 3, title: "Confirm every vendor and headcount", owner: "Logistics Lead", detail: "Final counts to caterer, delivery windows, day-of contacts" },
  { id: "load-in", t: 1, title: "Load-in and setup", small: "Setup", owner: "Logistics Lead", detail: "Signage, stations, registration desk, power and wifi tested" },
  { id: "event", t: 0, title: "Event day", owner: "Exec", detail: "Run sheet live; one owner per channel" },
  { id: "retro", t: -7, title: "Retro + thank-yous", owner: "Exec", detail: "What worked/broke/fix with numbers; attendee + sponsor surveys within 48h; prizes started" },
  { id: "close", t: -30, title: "All payments closed; handbook updated", small: "Settle payments and reimbursements", owner: "Finance", detail: "Vendor and prize payments done; lessons into the handbook" },
];

const FACTOR: Record<Scale, number> = { large: 1, medium: 0.4, small: 0.15, intimate: 0.05 };

/** Map a gate's owning role onto a role that exists at this scale. */
function ownerOf(o: string, names: Set<string>, fallback: string): string {
  if (names.has(o)) return o;
  const chain: Record<string, string[]> = {
    "Logistics Lead": ["Logistics", "Host"],
    "Venue & Services": ["Logistics Lead", "Logistics", "Host"],
    Food: ["Logistics Lead", "Logistics", "Host"],
    "Program & Run-of-show": ["Logistics Lead", "Logistics", "Host"],
    "Merch & Gifts": ["Logistics Lead", "Logistics", "Host"],
    "People Logistics": ["Logistics Lead", "Logistics", "Host"],
    Sponsorship: ["Exec", "Host"],
    Finance: ["Host"],
    Comms: ["Host"],
    Exec: ["Host"],
  };
  for (const c of chain[o] ?? []) if (names.has(c)) return c;
  return fallback;
}

export function buildWorkflow(plan: EventPlan, today = iso(new Date())): Workflow {
  const b = plan.brief;
  const scale = scaleOf(b.guests);
  const hackathon = /hack/i.test(`${b.eventType} ${b.title}`);
  const sponsors = (plan.ops?.sponsors.length ?? 0) > 0 || (hackathon && scale !== "intimate");
  const ctx: Ctx = { scale, hackathon, sponsors, permits: (plan.permits?.length ?? 0) > 0, merch: scale === "large" || (scale === "medium" && hackathon) };
  const teams = swarmRoles(scale, hackathon, sponsors);
  const names = new Set(teams.map((t) => t.name));
  const daysOut = Math.round((new Date(`${b.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / DAY);
  const done = new Set(plan.workflowDone ?? []);
  const little = scale === "small" || scale === "intimate";
  const tpls = GATES.filter((g) => (!g.when || g.when(ctx)) && !(little && g.skipSmall));
  let catchUp = 0;
  const gates: Gate[] = tpls.map((g) => {
    const tMinus = g.t <= 0 ? g.t : Math.max(g.t > 1 ? 2 : 1, Math.round(g.t * FACTOR[scale]));
    const originalDue = addDays(b.date, -tMinus);
    let due = originalDue;
    if (!done.has(g.id) && originalDue < today && tMinus > 0 && daysOut > 0) {
      // Compress missed gates into a catch-up sequence between today and the day before the event.
      due = addDays(today, Math.min(Math.max(0, daysOut - 1), Math.floor(catchUp++ / 2)));
    }
    const status: GateStatus = done.has(g.id) ? "done" : due < today ? "past" : originalDue < today ? "overdue" : due <= addDays(today, 7) ? "this_week" : "upcoming";
    return { id: g.id, tMinus, due, originalDue, title: little && g.small ? g.small : g.title, owner: ownerOf(g.owner, names, teams[0].name), detail: g.detail, status };
  });
  const flags: SwarmFlags = { scale, sponsors, permits: ctx.permits, merch: ctx.merch, hackathon };
  return {
    scale,
    teams,
    phases: SWARM_PHASES,
    gates,
    cadence: swarmCadence(scale),
    trackers: swarmTrackers(flags),
    checks: swarmChecks(flags),
    guardrails: guardrailsFor(scale, sponsors),
    daysOut,
    compressed: catchUp,
  };
}

/** Guardrails stay numeric so a trade-off is decidable, not a debate. */
function guardrailsFor(scale: Scale, sponsors: boolean): string[] {
  if (scale === "small" || scale === "intimate") {
    return ["Book the venue and food before sending invites", "Keep one guest list with dietary needs", "Get every booking confirmed in writing"];
  }
  return [
    "A 10–15% contingency line sits in every budget",
    "Over budget, or a variance above 5%, needs Exec sign-off",
    "Deposits are capped at 50%; no spend without a signed quote or contract",
    "Vendor negotiation stops after 2 rounds, then Exec decides",
    "Money moves only through the purchase pipeline, never ad-hoc pings or shared vendor logins",
    ...(sponsors ? ["No perks or logos on merch before a signed contract; every sponsor gets a POC at signing; flag sponsors silent for 7 days"] : []),
    "Every shipment is logged with destination, receiver and arrive-by ≥3 days before load-in",
    "Design dates are computed backward from vendor order-by dates, so late requests show up months ahead",
    "Retro within 7 days; every project keeps a handoff note for next year",
  ];
}

/** Short text summary for Photon ("THIS WEEK"). */
export function thisWeekText(plan: EventPlan): string {
  const w = buildWorkflow(plan);
  const open = w.gates.filter((g) => g.status === "overdue" || g.status === "this_week" || g.status === "past");
  if (!open.length) return `${plan.brief.title}: nothing due this week. Next: ${w.gates.find((g) => g.status === "upcoming")?.title ?? "event day"}.`;
  return [`${plan.brief.title} · ${w.daysOut} days out${w.compressed ? ` · ${w.compressed} late gates compressed` : ""}`, ...open.slice(0, 6).map((g) => `${g.due.slice(5)} ${g.title} (${g.owner})${g.status === "overdue" ? " · late" : ""}`), open.length > 6 ? `+${open.length - 6} more in the Workflow tab.` : ""].filter(Boolean).join("\n");
}
