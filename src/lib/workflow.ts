import type { EventPlan } from "./types";

/**
 * Organizing workflow modeled on the Cal Hacks operations playbook (teams, T-minus gates, standard trackers),
 * generalized: teams collapse and gates shrink with event size and type, and late gates are compressed into a catch-up plan.
 */

export type Team = { name: string; size: string; owns: string; output: string };
export type GateStatus = "done" | "overdue" | "this_week" | "upcoming" | "past";
export type Gate = { id: string; tMinus: number; due: string; originalDue: string; title: string; owner: string; detail: string; status: GateStatus };
export type Scale = "large" | "medium" | "small" | "intimate";
export type Workflow = { scale: Scale; teams: Team[]; gates: Gate[]; cadence: string[]; trackers: string[]; daysOut: number; compressed: number };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(new Date(`${date}T12:00:00`).getTime() + n * DAY));

export function scaleOf(guests: number): Scale {
  return guests >= 1000 ? "large" : guests >= 150 ? "medium" : guests >= 20 ? "small" : "intimate";
}

function teamsFor(scale: Scale, hackathon: boolean, sponsors: boolean): Team[] {
  if (scale === "intimate") return [
    { name: "Host", size: "1", owns: "Guest list, venue/booking, budget, day-of hosting", output: "One checklist" },
    { name: "Helper", size: "1", owns: "Food, supplies, setup and cleanup", output: "Shopping list" },
  ];
  if (scale === "small") return [
    { name: "Host", size: "1", owns: "Decisions, budget sign-off, guest experience", output: "Plan + budget" },
    { name: "Logistics", size: "1–2", owns: "Venue, food and drink, rentals, setup", output: "Vendor list" },
    { name: "Comms", size: "1", owns: "Invites, RSVPs, reminders, photos", output: "Guest list" },
  ];
  const t: Team[] = [
    { name: "Exec", size: scale === "large" ? "2–3" : "1–2", owns: "Cadence, accountability, venue relationship, final spend approval", output: "Weekly leads + all-hands agendas" },
    { name: "Logistics", size: scale === "large" ? "8–10" : "2–4", owns: `Venue services, food, merch, ${hackathon ? "judges/mentors/volunteers, hardware, " : "volunteers, "}shipping, floorplan`, output: "Projects tracker (the hub)" },
  ];
  if (sponsors) t.push({ name: "Sponsorship", size: scale === "large" ? "8–10" : "1–2", owns: "Revenue, sponsor relationships and deliverables", output: "Deal sheet (shared with Finance)" });
  if (scale === "large") {
    t.push(
      { name: "Design", size: "5–6", owns: "Every visual and print file", output: "Design request sheet" },
      { name: "Marketing", size: "4–6", owns: `${hackathon ? "Applications drive, hacker emails" : "Registration drive, attendee emails"}, sponsor promos`, output: "Promotions sheet" },
      { name: "Finance", size: "4–5", owns: "Budget, payments, sponsor invoicing, prize/tax forms", output: "Budget sheet + payment queue" },
      { name: "Tech", size: "6–8", owns: `${hackathon ? "Application" : "Registration"}/check-in platform, site, network specs`, output: "Registration platform" },
      { name: hackathon ? "Hacker experience" : "Attendee experience", size: "4–6", owns: "Accessibility, wellness, community events", output: "Experience plans" },
    );
  } else {
    t.push({ name: "Comms & design", size: "1–3", owns: "Invites/registration, social, signage, slides", output: "Promotions + design requests" });
    t.push({ name: "Finance", size: "1", owns: "Budget, payments, receipts", output: "Budget sheet" });
  }
  return t;
}

type Tpl = { id: string; t: number; title: string; owner: string; detail: string; when?: (c: Ctx) => boolean; small?: string; skipSmall?: boolean };
type Ctx = { scale: Scale; hackathon: boolean; sponsors: boolean; permits: boolean; merch: boolean };
const big = (c: Ctx) => c.scale === "large" || c.scale === "medium";

// Offsets (days before the event) are the playbook's large-event timeline; smaller events scale them down.
const GATES: Tpl[] = [
  { id: "venue-shortlist", t: 300, title: "Venue long list + phone screens", skipSmall: true, owner: "Exec", detail: "4–6 candidates; screen capacity, overnight access, forced vendors, power/wifi, food policy, transit, loading, insurance" },
  { id: "venue-sign", t: 270, title: "Tour shortlist and sign the venue", small: "Book the venue", owner: "Exec", detail: "One tour each; score capacity, total cost incl. forced vendors, transit, power/wifi, vibe; Finance reviews deposits and cancellation" },
  { id: "sponsor-launch", t: 270, title: "Sponsorship launch", owner: "Sponsorship", detail: "Prospectus with tiers + à la carte, early-bird deadline; past sponsors first, then outbound", when: (c) => c.sponsors },
  { id: "budget-v1", t: 180, title: "Budget v1", small: "Set the budget", owner: "Finance", detail: "Category budgets from past actuals and committed sponsor total; exec signs off" },
  { id: "services-rfq", t: 120, title: "Big services RFQ", owner: "Logistics", detail: "Wifi, power, A/V, furniture: one written spec to ≥5 vendors each; negotiate with competing quotes", when: big },
  { id: "services-choose", t: 90, title: "Choose big-service vendors", owner: "Logistics", detail: "Final written quotes: what's included, delivery window, cancellation terms", when: big },
  { id: "brand", t: 90, title: "Theme and brand locked", owner: "Design", detail: "Theme, fonts, colors; post a theme guide", when: big },
  { id: "merch-scope", t: 90, title: "Merch scoped + meals shortlisted", owner: "Logistics", detail: "Every item gets a tracker row with vendor spec and order-by; design request dates computed backward", when: (c) => c.merch },
  { id: "apps-open", t: 84, title: "Applications open", owner: "Marketing", detail: "Hacker + judge/mentor/volunteer applications; MLH member-event application if partnering", when: (c) => c.hackathon },
  { id: "rsvp-open", t: 60, title: "Invites / registration open", owner: "Comms", detail: "Send invites or open registration; track RSVPs and dietary needs", when: (c) => !c.hackathon },
  { id: "meals-final", t: 70, title: "Meals finalized; long-lead merch ordered", owner: "Logistics", detail: "Call caterers for bulk discounts; sea freight needs ~25 days + customs", when: big },
  { id: "walkthrough-1", t: 56, title: "Walkthrough 1 + floorplan v1", owner: "Logistics", detail: "Measure rooms, outlets/circuits, food lines, sleeping, booths, stage; decor rules", when: big },
  { id: "decisions", t: 42, title: "Priority deadline; decisions out", owner: "Marketing", detail: "One-week confirmation window, reminder 48h before it closes", when: (c) => c.hackathon },
  { id: "sponsor-survey", t: 35, title: "Sponsor survey + judge/mentor deadline", owner: "Sponsorship", detail: "On-site names, parking, workshop times, prize tracks, email blurb", when: (c) => c.sponsors },
  { id: "orders", t: 28, title: "Orders and deposits", owner: "Finance", detail: "Domestic merch/print ordered, transport booked, wifi/power deposits, sponsor deliverables due" },
  { id: "permits", t: 21, title: "Permits filed / confirmed", owner: "Logistics", detail: "Fire/assembly, sound, food, insurance COI; expedite anything inside its lead time", when: (c) => c.permits },
  { id: "walkthrough-2", t: 14, title: "Final walkthrough + run-through", owner: "Exec", detail: "Final floorplan to fire marshal, event-day run-through, role guides sent", when: big },
  { id: "guide", t: 10, title: "Attendee guide + package audit", small: "Send guests the details (time, place, what to bring)", owner: "Comms", detail: "Guide with schedule, maps, channels; every shipment arrives ≥3 days before load-in" },
  { id: "confirm", t: 3, title: "Confirm every vendor and headcount", owner: "Logistics", detail: "Final counts to caterer, delivery windows, day-of contacts" },
  { id: "load-in", t: 1, title: "Load-in and setup", small: "Setup", owner: "Logistics", detail: "Signage, stations, registration desk, power and wifi tested" },
  { id: "event", t: 0, title: "Event day", owner: "Exec", detail: "Run sheet live; one owner per channel" },
  { id: "retro", t: -7, title: "Retro + thank-yous", owner: "Exec", detail: "What worked/broke/fix with numbers; attendee + sponsor surveys within 48h; prizes started" },
  { id: "close", t: -30, title: "All payments closed; handbook updated", small: "Settle payments and reimbursements", owner: "Finance", detail: "Vendor and prize payments done; lessons into the handbook" },
];

const FACTOR: Record<Scale, number> = { large: 1, medium: 0.4, small: 0.15, intimate: 0.05 };
const MIN_SPLIT: Record<Scale, number> = { large: 0, medium: 0, small: 0, intimate: 0 };

export function buildWorkflow(plan: EventPlan, today = iso(new Date())): Workflow {
  const b = plan.brief;
  const scale = scaleOf(b.guests);
  const hackathon = /hack/i.test(`${b.eventType} ${b.title}`);
  const sponsors = (plan.ops?.sponsors.length ?? 0) > 0 || (hackathon && scale !== "intimate");
  const ctx: Ctx = { scale, hackathon, sponsors, permits: (plan.permits?.length ?? 0) > 0, merch: scale === "large" || (scale === "medium" && hackathon) };
  const teams = teamsFor(scale, hackathon, sponsors);
  const names = new Set(teams.map((t) => t.name));
  const ownerOf = (o: string) => (names.has(o) ? o : o === "Comms" && names.has("Comms & design") ? "Comms & design" : o === "Marketing" && names.has("Comms & design") ? "Comms & design" : o === "Design" && names.has("Comms & design") ? "Comms & design" : names.has("Logistics") && !["Exec", "Finance"].includes(o) ? "Logistics" : teams[0].name);
  const daysOut = Math.round((new Date(`${b.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / DAY);
  const done = new Set(plan.workflowDone ?? []);
  const little = scale === "small" || scale === "intimate";
  const tpls = GATES.filter((g) => (!g.when || g.when(ctx)) && !(little && g.skipSmall));
  let catchUp = 0;
  const gates: Gate[] = tpls.map((g) => {
    const tMinus = g.t <= 0 ? g.t : Math.max(g.t > 1 ? 2 : 1, Math.round(g.t * FACTOR[scale]) + MIN_SPLIT[scale]);
    const originalDue = addDays(b.date, -tMinus);
    let due = originalDue;
    if (!done.has(g.id) && originalDue < today && tMinus > 0 && daysOut > 0) {
      // Compress missed gates into a catch-up sequence between today and the day before the event.
      due = addDays(today, Math.min(Math.max(0, daysOut - 1), Math.floor(catchUp++ / 2)));
    }
    const status: GateStatus = done.has(g.id) ? "done" : due < today ? "past" : originalDue < today ? "overdue" : due <= addDays(today, 7) ? "this_week" : "upcoming";
    return { id: g.id, tMinus, due, originalDue, title: little && g.small ? g.small : g.title, owner: ownerOf(g.owner), detail: g.detail, status };
  });
  const cadence =
    scale === "large"
      ? ["Each team meets weekly", "Leads meet weekly for 1h right before all-hands", "All-hands weekly; every team fills one status slide", "From T-4 weeks leads meet every week, no exceptions; T-2 weeks: event-day run-through"]
      : scale === "medium"
        ? ["Core team syncs weekly (30 min)", "Daily check-ins in the final week", "Run-through 2–3 days before"]
        : ["Quick check-in when something changes", "Final confirmation 2–3 days before"];
  const trackers =
    scale === "intimate"
      ? ["One checklist (this plan's tasks)"]
      : [
          "Projects tracker: owner, deliverable, status, qty, unit cost, vendor, order-by, ship-by",
          ...(sponsors ? ["Sponsor deal sheet: the only record of amounts (count only once signed)"] : []),
          ...(big(ctx) ? ["Design requests: request due = design due − 2 weeks; design due = order-by − proofs", "Purchase requests: budget-line check + scam check before paying", "Package tracking: every item arrives ≥3 days before load-in"] : []),
          "Contracts folder: upload every signed doc the day it's signed",
        ];
  return { scale, teams, gates, cadence, trackers, daysOut, compressed: catchUp };
}

/** Short text summary for Photon ("THIS WEEK"). */
export function thisWeekText(plan: EventPlan): string {
  const w = buildWorkflow(plan);
  const open = w.gates.filter((g) => g.status === "overdue" || g.status === "this_week" || g.status === "past");
  if (!open.length) return `${plan.brief.title}: nothing due this week. Next: ${w.gates.find((g) => g.status === "upcoming")?.title ?? "event day"}.`;
  return [`${plan.brief.title} · ${w.daysOut} days out${w.compressed ? ` · ${w.compressed} late gates compressed` : ""}`, ...open.slice(0, 6).map((g) => `${g.due.slice(5)} ${g.title} (${g.owner})${g.status === "overdue" ? " · late" : ""}`), open.length > 6 ? `+${open.length - 6} more in the Workflow tab.` : ""].filter(Boolean).join("\n");
}
