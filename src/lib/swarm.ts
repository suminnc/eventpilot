import type { AgentId, EventPlan } from "./types";
import { buildWorkflow } from "./workflow";

/**
 * EventPilot Autonomous Ops Team v2.0.0.
 * Exec owns scope and sign-off, the Logistics lead decides what the event needs and fans out to one sub-agent per
 * applicable category, Finance holds an affordability veto, and an independent Verifier checks the result before Exec
 * approves. Decisions are deterministic rules so the agents actually check each other instead of agreeing.
 */

export const SWARM_VERSION = "2.0.0";
export const SWARM_NAME = "EventPilot Autonomous Ops Team";

export type CategoryKey = "food" | "venue" | "program" | "merch" | "people" | "sponsorship" | "comms";
export type SwarmCategory = { key: CategoryKey; name: string; agent: AgentId; owns: string; applies: boolean; why: string; line: number; estimate: number; vendors: string[] };
export type FinanceVerdict = { category: string; line: number; estimate: number; variancePct: number; verdict: "approve" | "escalate" | "send_back"; reason: string };
export type DecisionMemo = { id: string; topic: string; options: string[]; recommendation: string; decision: string; decidedBy: "exec" };
export type VerifyCheck = { check: string; ok: boolean; blocker: boolean; detail: string };
export type SwarmReport = {
  version: string;
  scope: { mustHaves: string[]; niceToHaves: string[]; envelope: number; contingency: number; contingencyPct: number };
  categories: SwarmCategory[];
  finance: FinanceVerdict[];
  memos: DecisionMemo[];
  verification: VerifyCheck[];
  approved: boolean;
  approval: string;
  thisWeek: string[];
};

export const RACI: { role: string; agent: AgentId; decides: string }[] = [
  { role: "Exec", agent: "exec", decides: "Scope and must-haves, attendee-experience priority, any over-budget or >5% variance, decision memos, day-of command" },
  { role: "Logistics lead", agent: "lead", decides: "What the event needs, vendor choice, first sign-off on vendor vetting, reconciling the sub-agents" },
  { role: "Finance", agent: "finance", decides: "Affordability veto, deposit cap (50%), payment method (card, never wire), ledger reconciliation, second sign-off on vetting" },
  { role: "Category agents", agent: "food", decides: "Options, ≥5 comparable quotes on an identical spec for large services, quality-vs-cost trade-off, a recommendation" },
  { role: "Sponsorship", agent: "sponsorship", decides: "Revenue and deliverables; a deal counts only once the contract is signed" },
  { role: "Comms", agent: "comms", decides: "Invites, reminders, attendee guide and on-site comms" },
  { role: "Verifier", agent: "verifier", decides: "Independent check before Exec approval: owners, dates vs gates, no unsigned spend" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const VARIANCE = 0.05;

const DEFS: { key: CategoryKey; name: string; agent: AgentId; owns: string; line: RegExp; vendor: RegExp }[] = [
  { key: "food", name: "Food", agent: "food", owns: "Catering, dietary split, portions, delivery timing", line: /food|cater|meal|drink|snack/i, vendor: /food|cater|meal|drink|snack/i },
  { key: "venue", name: "Venue & Services", agent: "venue", owns: "Venue, Wi-Fi, power, A/V, furniture, decor & supplies, staffing & security, permits, COI, floorplan", line: /venue|\bav\b|wi-?fi|rental|staff|secur|permit|insur|decor|floral|suppl|misc|tent/i, vendor: /venue|\bav\b|wi-?fi|rental|staff|secur|tent|furniture|decor|floral|suppl/i },
  { key: "program", name: "Program & Run-of-show", agent: "program", owns: "Agenda, attendee-facing schedule, day-of timing, photo/video", line: /program|entertain|photo|video|music|dj|attire|beauty/i, vendor: /photo|video|entertain|dj|music|attire|beauty/i },
  { key: "merch", name: "Merch & Gifts", agent: "merch", owns: "Swag, print, prizes, speaker gifts, signage art (prizes route tax forms to Finance)", line: /swag|merch|prize|gift|print|sign/i, vendor: /swag|merch|prize|gift|print|sign/i },
  { key: "people", name: "People Logistics", agent: "people", owns: "Buses, shuttles, hotels, travel", line: /transport|travel|bus|shuttle|hotel/i, vendor: /transport|travel|bus|shuttle|hotel/i },
  { key: "sponsorship", name: "Sponsorship", agent: "sponsorship", owns: "Revenue, sponsor tiers, deal sheet, deliverables", line: /sponsor/i, vendor: /sponsor/i },
  { key: "comms", name: "Comms", agent: "comms", owns: "Invites, reminders, attendee guide, marketing", line: /market|comms|promo/i, vendor: /market|promo|social/i },
];

export function categoryOf(label: string): CategoryKey | undefined {
  return DEFS.find((d) => d.vendor.test(label) || d.line.test(label))?.key;
}

export function buildSwarm(plan: EventPlan, today = new Date().toISOString().slice(0, 10)): SwarmReport {
  const b = plan.brief;
  const text = `${b.prompt ?? ""} ${b.constraints.join(" ")}`.toLowerCase();
  const contingency = plan.budget.filter((l) => /contingency|buffer|reserve/i.test(l.category)).reduce((s, l) => s + l.amount, 0);
  const contingencyPct = b.budget ? contingency / b.budget : 0;
  const venue = plan.venues[plan.selectedVenue];

  const categories: SwarmCategory[] = DEFS.map((d) => {
    const line = plan.budget.filter((l) => d.line.test(l.category)).reduce((s, l) => s + l.amount, 0);
    const vs = plan.vendors.filter((v) => d.vendor.test(v.category));
    let estimate = vs.reduce((s, v) => s + v.estCost, 0);
    if (d.key === "venue" && !vs.some((v) => /venue/i.test(v.category))) estimate += plan.budget.find((l) => l.category === "Venue")?.amount ?? 0;
    if (!vs.length && d.key !== "venue") estimate = line;
    const why =
      d.key === "people" ? (/bus|shuttle|hotel|travel|flight/.test(text) ? "The brief mentions travel" : "No travel in the brief")
      : d.key === "sponsorship" ? (plan.ops?.sponsors.length ? `${plan.ops.sponsors.length} sponsor tiers, ${money(plan.ops.sponsorTarget)} target` : "No sponsors for this event")
      : d.key === "merch" ? (line || vs.length ? "Swag/prizes in the budget" : "No merch or prizes budgeted")
      : d.key === "food" ? (line || vs.length ? `${plan.ops?.meals.length ?? 0} meals` : "No food budgeted")
      : d.key === "venue" ? (venue ? venue.name : "Venue TBD")
      : d.key === "program" ? `${plan.schedule.length} schedule blocks`
      : "Invite, reminders and attendee guide";
    const applies =
      d.key === "people" ? /bus|shuttle|hotel|travel|flight/.test(text)
      : d.key === "sponsorship" ? !!plan.ops?.sponsors.length
      : d.key === "merch" ? !!(line || vs.length)
      : d.key === "food" ? !!(line || vs.length)
      : true;
    return { key: d.key, name: d.name, agent: d.agent, owns: d.owns, applies, why, line: Math.round(line), estimate: Math.round(estimate), vendors: vs.map((v) => v.category) };
  });

  let headroom = contingency;
  const finance: FinanceVerdict[] = [];
  const memos: DecisionMemo[] = [];
  for (const c of categories.filter((x) => x.applies && x.key !== "sponsorship" && (x.line || x.estimate))) {
    const line = c.line || c.estimate;
    const over = c.estimate - line;
    const pct = line ? over / line : 0;
    if (pct <= VARIANCE) {
      finance.push({ category: c.name, line, estimate: c.estimate, variancePct: Math.round(pct * 1000) / 10, verdict: "approve", reason: over > 0 ? `${Math.round(pct * 100)}% over, inside the 5% tolerance` : "Inside its budget line" });
      continue;
    }
    const fits = over <= headroom;
    finance.push({ category: c.name, line, estimate: c.estimate, variancePct: Math.round(pct * 1000) / 10, verdict: fits ? "escalate" : "send_back", reason: fits ? `${money(over)} over (${Math.round(pct * 100)}%): needs Exec sign-off to use contingency` : `${money(over)} over and only ${money(headroom)} contingency left: trim scope or re-quote` });
    const rec = fits ? `Use ${money(over)} of contingency` : `Trim ${c.name.toLowerCase()} scope by ${money(over - headroom)} or re-quote`;
    memos.push({ id: `memo-${c.key}`, topic: `${c.name} is ${Math.round(pct * 100)}% over its ${money(line)} line`, options: [`Use ${money(Math.min(over, headroom))} of contingency`, `Trim ${c.name.toLowerCase()} scope to fit`, "Re-quote with the cheapest comparable vendor"], recommendation: rec, decision: rec, decidedBy: "exec" });
    if (fits) headroom -= over;
  }

  const fees = (plan.permits ?? []).reduce((s, p) => s + (p.fee || 0), 0);
  if (fees && !plan.budget.some((l) => /permit/i.test(l.category))) {
    const fits = fees <= headroom;
    finance.push({ category: "Permits", line: 0, estimate: fees, variancePct: 100, verdict: fits ? "escalate" : "send_back", reason: fits ? `${money(fees)} in permit fees have no budget line: paid from contingency with Exec sign-off` : `${money(fees)} in permit fees exceed the ${money(headroom)} contingency left` });
    const rec = fits ? `Pay ${money(fees)} permit fees from contingency` : `Find ${money(fees - headroom)} by trimming another category`;
    memos.push({ id: "memo-permits", topic: `Permit fees (${money(fees)}) aren't budgeted`, options: ["Pay from contingency", "Trim another category", "Ask the venue which permits it already holds"], recommendation: rec, decision: rec, decidedBy: "exec" });
    if (fits) headroom -= fees;
  }
  const a = plan.autopilot;
  const threads = a?.threads ?? [];
  const live = (a?.purchases ?? []).filter((p) => p.status === "auto_approved" || p.status === "approved");
  const unsigned = live.filter((p) => threads.some((t) => t.category === p.category && t.vendor === p.vendor && t.status !== "booked" && t.status !== "agreed"));
  const deposits = (a?.purchases ?? []).filter((p) => Number(p.purpose.match(/\((\d+)%\)/)?.[1] ?? 0) > 50);
  const big = (a?.shortlists ?? []).filter((s) => s.target >= 20000 && s.quotes.length < 5);
  const wf = buildWorkflow(plan, today);
  const overdue = wf.gates.filter((g) => g.status === "overdue");
  const sum = plan.budget.reduce((s, l) => s + l.amount, 0);
  const verification: VerifyCheck[] = [
    { check: "Budget lines add up to the budget", ok: sum <= b.budget * 1.001, blocker: true, detail: `${money(sum)} of ${money(b.budget)}` },
    { check: "Contingency is 10–15%", ok: contingencyPct >= 0.095 && contingencyPct <= 0.155, blocker: false, detail: `${Math.round(contingencyPct * 100)}% (${money(contingency)})` },
    { check: "Every task has an owner and a date", ok: plan.tasks.every((t) => t.owner && t.due), blocker: false, detail: `${plan.tasks.filter((t) => !t.owner || !t.due).length} missing` },
    { check: "Every vendor belongs to a category agent", ok: plan.vendors.every((v) => categoryOf(v.category)), blocker: false, detail: plan.vendors.filter((v) => !categoryOf(v.category)).map((v) => v.category).join(", ") || "all owned" },
    { check: "Dates checked against T-minus gates", ok: overdue.length === 0, blocker: false, detail: overdue.length ? `${overdue.length} gate(s) late, compressed into the catch-up plan` : "on schedule" },
    { check: "Permits have filing deadlines", ok: (plan.permits ?? []).every((p) => p.deadline), blocker: false, detail: `${plan.permits?.length ?? 0} permits` },
    { check: "No unsigned deal counted as spend", ok: unsigned.length === 0, blocker: true, detail: unsigned.length ? unsigned.map((p) => p.vendor).join(", ") : "none" },
    { check: "Deposits capped at 50%", ok: deposits.length === 0, blocker: true, detail: deposits.length ? deposits.map((p) => p.vendor).join(", ") : "all ≤ 50%" },
    { check: "≥5 comparable quotes for large services", ok: big.length === 0, blocker: false, detail: big.length ? big.map((s) => s.category).join(", ") : a?.shortlists?.length ? "met" : "quotes come when Autopilot runs" },
  ];
  const blockers = verification.filter((v) => !v.ok && v.blocker);
  const sent = finance.filter((f) => f.verdict === "send_back");
  const approved = !blockers.length && !sent.length;
  const approval = approved
    ? `Exec approved: ${categories.filter((c) => c.applies).length} categories, ${memos.length} decision memo${memos.length === 1 ? "" : "s"} resolved, ${verification.filter((v) => !v.ok).length} warning(s).`
    : `Exec holding approval: ${[...blockers.map((v) => v.check), ...sent.map((f) => `${f.category} sent back by Finance`)].join("; ")}.`;
  const thisWeek = wf.gates.filter((g) => g.status === "this_week" || g.status === "overdue").slice(0, 6).map((g) => `${g.title} (${g.owner}, due ${g.due})`);
  const mustHaves = [`${b.guests.toLocaleString()} ${b.eventType === "hackathon" ? "hackers" : "guests"} on ${b.date}`, ...(venue ? [`Venue: ${venue.name}`] : []), ...b.constraints.slice(0, 6)];
  const niceToHaves = [`${b.vibe} feel`, ...(plan.ops?.sponsors.length ? ["Sponsor expo and workshops"] : []), "Photo/video recap"];
  return { version: SWARM_VERSION, scope: { mustHaves, niceToHaves, envelope: Math.round(b.budget - contingency), contingency: Math.round(contingency), contingencyPct: Math.round(contingencyPct * 1000) / 10 }, categories, finance, memos, verification, approved, approval, thisWeek };
}

export function swarmText(plan: EventPlan): string {
  const s = buildSwarm(plan);
  const on = s.categories.filter((c) => c.applies).map((c) => c.name).join(", ");
  const fin = s.finance.filter((f) => f.verdict !== "approve").map((f) => `${f.category}: ${f.reason}`);
  const warn = s.verification.filter((v) => !v.ok).map((v) => `${v.check} (${v.detail})`);
  return [
    `${SWARM_NAME} v${s.version} · ${plan.brief.title}`,
    `Agents on: Exec, Logistics lead, Finance, ${on}, Verifier.`,
    fin.length ? `Finance: ${fin.join("; ")}` : "Finance approved every category.",
    ...s.memos.map((m) => `Exec memo: ${m.topic} → ${m.decision}`),
    warn.length ? `Verifier flags: ${warn.slice(0, 3).join("; ")}` : "Verifier: all checks pass.",
    s.approval,
  ].join("\n");
}
