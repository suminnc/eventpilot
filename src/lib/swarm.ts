/**
 * The EventPilot swarm — the organizing crew modelled on the subteam roles.
 *
 * One Exec owns delivery and the attendee experience. A Logistics lead decides what this event
 * actually needs and distributes the work to one sub-agent per overarching task. Finance gates every
 * dollar with an affordability veto. Sponsorship owns the revenue lever and Comms owns the attendee
 * voice. A Verifier adversarially checks the result before Exec approves.
 *
 * The roster, the control loop, the decision rights and the guardrails all live here as data, so the
 * Workflow tab, the planner and the docs share one source of truth.
 */

export type Scale = "large" | "medium" | "small" | "intimate";

export type SwarmRole = {
  name: string;
  size: string;
  owns: string;
  output: string;
  /** Reporting line — sub-agents report to their lead. */
  lead?: string;
  /** Sub-agents this role distributes to (only set on the lead's row). */
  subteams?: string[];
};

export type SwarmPhase = { id: string; title: string; owner: string; dependsOn: string[]; does: string };
export type DecisionRight = { who: string; decides: string };
export type Check = { handoff: string; checker: string; check: string };

export const scaleOf = (guests: number): Scale =>
  guests >= 1000 ? "large" : guests >= 150 ? "medium" : guests >= 20 ? "small" : "intimate";

/** One sub-agent per overarching logistics task. The lead activates only the ones this event needs. */
export const LOGISTICS_SUBAGENTS: SwarmRole[] = [
  { name: "Food", size: "1", owns: "Catering, dietary needs, portions and delivery windows", output: "Food row in the projects tracker", lead: "Logistics Lead" },
  { name: "Venue & Services", size: "1", owns: "Wifi, power, A/V, furniture, rigging, permits, COI and the floorplan", output: "Services rows + floorplan", lead: "Logistics Lead" },
  { name: "Program & Run-of-show", size: "1", owns: "The attendee-facing agenda and day-of timing", output: "Run-of-show", lead: "Logistics Lead" },
  { name: "Merch & Gifts", size: "1", owns: "Swag, print, signage art, attendee prizes and speaker gifts", output: "Merch rows + design requests", lead: "Logistics Lead" },
  { name: "People Logistics", size: "1", owns: "Buses, hotels, parking and travel — only when the event needs it", output: "Transport plan", lead: "Logistics Lead" },
];

export function swarmRoles(scale: Scale, hackathon: boolean, sponsors: boolean): SwarmRole[] {
  void hackathon;
  if (scale === "intimate") {
    return [
      { name: "Host", size: "1", owns: "Guest list, venue/booking, budget, day-of hosting", output: "One checklist" },
      { name: "Helper", size: "1", owns: "Food, supplies, setup and cleanup", output: "Shopping list" },
    ];
  }
  if (scale === "small") {
    return [
      { name: "Host", size: "1", owns: "Decisions, budget sign-off, guest experience", output: "Plan + budget" },
      { name: "Logistics", size: "1–2", owns: "Venue, food and drink, rentals, setup", output: "Vendor list" },
      { name: "Comms", size: "1", owns: "Invites, RSVPs, reminders, photos", output: "Guest list" },
    ];
  }
  const roles: SwarmRole[] = [
    { name: "Exec", size: "1", owns: "Owns delivery and the attendee experience; scope, priority, over-budget approval, day-of command", output: "Attendee-experience rubric + weekly leads" },
    {
      name: "Logistics Lead",
      size: "1",
      owns: "Decides what this event needs, distributes the work, reconciles the final plan",
      output: "Projects tracker (the hub)",
      subteams: LOGISTICS_SUBAGENTS.map((s) => s.name),
    },
    ...LOGISTICS_SUBAGENTS,
  ];
  if (sponsors) roles.push({ name: "Sponsorship", size: "1", owns: "Revenue, sponsor relationships and deliverables — the revenue lever", output: "Deal sheet (shared with Finance)" });
  roles.push({ name: "Finance", size: "1", owns: "Budget, the cost gate, payments, sponsor invoicing and tax forms", output: "Budget ledger + payment queue" });
  roles.push({ name: "Comms", size: "1", owns: "The attendee guide and the reminder sequence", output: "Attendee guide + promotions" });
  return roles;
}

/** The autonomous control loop. Each phase runs with no human input; the loop closes at Exec approval. */
export const SWARM_PHASES: SwarmPhase[] = [
  { id: "exec_scope", title: "Exec sets scope", owner: "Exec", dependsOn: [], does: "Publishes the attendee-experience must-haves, the budget envelope and the guardrails." },
  { id: "logistics_plan", title: "Logistics lead scopes the event", owner: "Logistics Lead", dependsOn: ["exec_scope"], does: "Decides which categories this event needs and writes the projects-tracker skeleton." },
  { id: "categories", title: "Sub-agents run in parallel", owner: "Food · Venue & Services · Program · Merch & Gifts · People Logistics", dependsOn: ["logistics_plan"], does: "Each returns options, 3 quotes on one spec, a below-budget anchor and a nonprofit-discount ask." },
  { id: "revenue", title: "Sponsorship works the pipeline", owner: "Sponsorship", dependsOn: ["exec_scope"], does: "Deal sheet per prospect; a deal counts only once the contract is signed." },
  { id: "comms", title: "Comms writes the attendee guide", owner: "Comms", dependsOn: ["exec_scope"], does: "Attendee guide plus the T-10d / T-3d / day-of reminder sequence." },
  { id: "finance_gate", title: "Finance gates every dollar", owner: "Finance", dependsOn: ["categories", "revenue"], does: "Budget-line cap, deposit ≤50%, payment method — approve, condition or veto." },
  { id: "reconcile", title: "Logistics lead reconciles", owner: "Logistics Lead", dependsOn: ["finance_gate"], does: "One plan, one owner per row; quality-vs-cost deadlocks go to Exec as a decision memo." },
  { id: "verify", title: "Verifier checks adversarially", owner: "Verifier", dependsOn: ["reconcile"], does: "Every row has owner/date/vendor, dates sit upstream of their gates, no unsigned spend or unsourced numbers." },
  { id: "exec_approve", title: "Exec approves and publishes", owner: "Exec", dependsOn: ["verify"], does: "Resolves open decisions and publishes the this-week action list." },
];

export const DECISION_RIGHTS: DecisionRight[] = [
  { who: "Exec", decides: "Scope, priority, over-budget approval, day-of command" },
  { who: "Logistics Lead", decides: "What the event needs and which vendor" },
  { who: "Finance", decides: "Affordability — a binding veto on spend" },
  { who: "Sub-agents", decides: "Options and trade-offs, never the final call" },
  { who: "Verifier", decides: "Defects; Exec resolves what survives verification" },
];

export const GUARDRAILS: string[] = [
  "A 10–15% contingency line sits in every budget",
  "Over budget, or a variance above 5%, needs Exec sign-off",
  "Deposits are capped at 50%",
  "No spend without a signed quote or contract",
  "Vendor negotiation stops after 2 rounds, then Exec decides",
  "Pay by card or escrow — never wire to a changed account; Wise/ACH for international",
  "No shared vendor logins; pay from finance-held accounts or virtual cards",
  "Any new vendor, international order or deposit over $500 runs the vendor-vetting checklist",
];

export type SwarmFlags = { scale: Scale; sponsors: boolean; permits: boolean; merch: boolean; hackathon: boolean };
const big = (c: SwarmFlags) => c.scale === "large" || c.scale === "medium";

/** Who checks whose work — the mechanism that keeps the swarm honest. */
export function swarmChecks(c: SwarmFlags): Check[] {
  if (c.scale === "small" || c.scale === "intimate") {
    return [
      { handoff: "Any purchase", checker: "Host", check: "Within budget? Vendor confirmed in writing? Pay by card, deposit ≤50%" },
      { handoff: "Vendor → you", checker: "Host", check: "Confirm final count, delivery window and cancellation terms 2–3 days before" },
    ];
  }
  return [
    { handoff: "Food / Venue / Program / Merch / People → Logistics Lead", checker: "Logistics Lead", check: "Complete tracker row — owner, vendor, cost, order-by — and 3 quotes on one spec" },
    { handoff: "Any spend → Finance", checker: "Finance", check: "Budget line has room, deposit ≤50%, card over wire; approve, condition or veto" },
    { handoff: "Over-budget item or big contract → Exec", checker: "Exec", check: "Is the upgrade worth the experience it buys, and do the performance terms hold?" },
    ...(c.sponsors
      ? [
          { handoff: "Sponsorship → Finance", checker: "Finance", check: "Contract + invoice only after negotiation ends; one shared deal sheet; counts only once signed" },
          { handoff: "Sponsorship → Logistics / Comms", checker: "Logistics Lead", check: "Booth, power and map placement; promo obligations logged with dates" },
        ]
      : []),
    ...(c.permits ? [{ handoff: "Venue & Services → Venue / fire marshal", checker: "Venue & Services", check: "Floorplan approval, permits for gas/flame, fire-rated signage, delivery windows" }] : []),
    ...(c.merch ? [{ handoff: "Vendor proof → requester", checker: "Requester + Merch & Gifts", check: "Proof checked (spelling, dates, colors, size) before paying" }] : []),
    { handoff: "Reconciled plan → Verifier", checker: "Verifier", check: "Every row has owner/date/vendor; dates upstream of the T-minus gates; no unsigned spend, no unsourced numbers" },
    { handoff: "Verifier defects → Exec", checker: "Exec", check: "Resolve or escalate every defect before publishing the this-week list" },
  ];
}

/** Cadence and shared trackers, scaled to the event. */
export function swarmCadence(scale: Scale): string[] {
  if (scale === "large") {
    return [
      "Each sub-agent reports to its lead weekly",
      "Leads meet weekly for 1h right before all-hands",
      "All-hands weekly; every team fills one status slide",
      "From T-4 weeks leads meet every week, no exceptions; T-2 weeks: event-day run-through",
      "team@ has a weekly rotating owner, 24-hour reply target; one email domain for every inbox",
    ];
  }
  if (scale === "medium") return ["Core team syncs weekly (30 min)", "Daily check-ins in the final week", "Run-through 2–3 days before"];
  return ["Quick check-in when something changes", "Final confirmation 2–3 days before"];
}

export function swarmTrackers(c: SwarmFlags): string[] {
  if (c.scale === "intimate") return ["One checklist (this plan's tasks)"];
  return [
    "Projects tracker: owner, deliverable, status, qty, unit cost, vendor, order-by, ship-by",
    ...(c.sponsors ? ["Sponsor deal sheet: the only record of amounts (count only once signed)"] : []),
    ...(big(c) ? ["Design requests: request due = design due − 2 weeks; design due = order-by − proofs", "Purchase requests: budget-line check + scam check before paying", "Package tracking: every item arrives ≥3 days before load-in"] : []),
    "Contracts folder: upload every signed doc the day it's signed",
  ];
}
