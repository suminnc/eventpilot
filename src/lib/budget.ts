import { billableHours } from "./tools";
import type { BudgetLine, EventBrief, Venue } from "./types";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const SPLITS: Record<string, [string, number][]> = {
  hackathon: [["Food & drinks", 0.38], ["Prizes", 0.18], ["Swag", 0.1], ["AV & Wi-Fi", 0.08], ["Staffing & security", 0.06], ["Marketing", 0.04]],
  wedding: [["Catering & bar", 0.4], ["Photo & video", 0.12], ["Music / DJ", 0.08], ["Florals & decor", 0.1], ["Attire & beauty", 0.06]],
  default: [["Food & drinks", 0.4], ["Decor & ambiance", 0.1], ["Entertainment", 0.12], ["AV & equipment", 0.06], ["Supplies & misc", 0.06]],
};

export function allocateBudget(brief: EventBrief, venue: Venue | undefined): BudgetLine[] {
  const hrs = billableHours(brief.durationHours);
  const venueCost = venue ? venue.pricePerHour * hrs : brief.budget * 0.25;
  const contingency = Math.round(brief.budget * 0.08);
  const remaining = Math.max(0, brief.budget - venueCost - contingency);
  const split = SPLITS[brief.eventType] || SPLITS.default;
  const totalW = split.reduce((s, [, w]) => s + w, 0);
  const out: BudgetLine[] = [{ category: "Venue", amount: Math.round(venueCost), note: venue ? (venue.pricePerHour ? `${venue.name}, ${hrs} billable h @ ${money(venue.pricePerHour)}/hr` : `${venue.name}, no room fee`) : "Estimated" }];
  for (const [c, w] of split) {
    const amt = Math.round((remaining * w) / totalW);
    out.push({ category: c, amount: amt, note: c.startsWith("Food") || c.startsWith("Catering") ? `≈ ${money(amt / brief.guests)} per guest` : "" });
  }
  out.push({ category: "Contingency", amount: contingency, note: "8% buffer for surprises" });
  const drift = brief.budget - out.reduce((s, l) => s + l.amount, 0);
  if (drift && remaining > 0) out.reduce((a, l) => (l !== out[0] && l.amount > a.amount ? l : a), out[1]).amount += drift;
  return out;
}
