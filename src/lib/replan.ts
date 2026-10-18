import { allocateBudget, fundPermits } from "./budget";
import { linkPermitTasks, permitChecklist } from "./permits";
import { opsPlan } from "./ops";
import type { EventPlan } from "./types";

/** Re-derive everything that depends on the venue when the user picks a different one. */
export function reselectVenue(plan: EventPlan, idx: number): EventPlan {
  const from = plan.venues[plan.selectedVenue];
  const to = plan.venues[idx];
  if (!to || idx === plan.selectedVenue) return plan;
  const swap = (s: string) => {
    if (!from) return s;
    const out = s.split(from.name).join(to.name);
    return from.neighborhood && from.neighborhood !== to.neighborhood ? out.split(from.neighborhood).join(to.neighborhood) : out;
  };
  const { permits, tasks: permitTasks } = linkPermitTasks(permitChecklist(plan.brief, to, plan.vendors));
  const tasks = [
    ...plan.tasks.filter((t) => t.agent !== "permits").map((t) => ({ ...t, title: swap(t.title) })),
    ...permitTasks,
  ].sort((a, b) => a.due.localeCompare(b.due));
  const late = permits.filter((p) => p.atRisk);
  const venueCost = allocateBudget(plan.brief, to)[0].amount;
  const risks = plan.risks
    .filter((r) => !/permit|venue|capacity|budget share|outdoor/i.test(r.issue))
    .concat(
      to.capacity < plan.brief.guests ? [{ level: "high" as const, issue: `${to.name} holds ${to.capacity}, below ${plan.brief.guests} guests`, mitigation: "Pick a larger venue or cap registration." }] : [],
      venueCost > plan.brief.budget * 0.5 ? [{ level: "medium" as const, issue: `Venue is ${Math.round((venueCost / plan.brief.budget) * 100)}% of the budget`, mitigation: "Negotiate a nonprofit/day rate or pick a cheaper venue." }] : [],
      !to.indoor ? [{ level: "medium" as const, issue: `${to.name} is outdoors`, mitigation: "Hold a tent/indoor backup and set a rain-call deadline." }] : [],
      late.length ? [{ level: "high" as const, issue: `${late.length} permit${late.length > 1 ? "s" : ""} past normal lead time: ${late.map((p) => p.name).join("; ")}`, mitigation: "Call each agency today for expedited review, and ask the venue which standing permits it already holds." }] : [],
    );
  return {
    ...plan,
    selectedVenue: idx,
    summary: swap(plan.summary),
    invite: { subject: swap(plan.invite.subject), body: swap(plan.invite.body), sms: swap(plan.invite.sms) },
    schedule: plan.schedule.map((s) => ({ ...s, title: swap(s.title), detail: swap(s.detail) })),
    budget: fundPermits(allocateBudget(plan.brief, to), permits),
    permits,
    ops: plan.ops ? opsPlan(plan.brief, plan.schedule, to) : plan.ops,
    tasks,
    risks,
    autopilot: undefined,
  };
}
