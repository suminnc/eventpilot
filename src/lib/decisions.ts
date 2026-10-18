import type { EventPlan, Purchase } from "./types";
import { appendAudit, committed, decide, switchQuote } from "./autopilot";

/** Organizer decisions over text (Photon iMessage/SMS or the in-app simulated thread). Pure: plan in, plan + reply out. */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const refNum = (p: Purchase) => Number(p.id.replace(/^p/, "")) + 1;
const ref = (p: Purchase) => `#${refNum(p)}`;
const line = (p: Purchase) => `${ref(p)} ${p.purpose} · ${p.vendor} · ${money(p.amount)}`;
export function help(plan: EventPlan): string {
  const a = plan.autopilot;
  const pending = a?.purchases.filter((p) => p.status === "pending") ?? [];
  const n = pending.length ? refNum(pending[pending.length - 1]) : null;
  return n ? `Reply YES ${n}, NO ${n}${pending.length > 1 ? ", ALL YES" : ""} or STATUS.` : "Text STATUS, VENDORS or NEGOTIATE <CATEGORY> TO <price> anytime.";
}

export function untexted(plan: EventPlan): Purchase[] {
  const a = plan.autopilot;
  if (!a) return [];
  return a.purchases.filter((p) => p.status === "pending" && !(a.texted ?? []).includes(p.id));
}

export function decisionText(plan: EventPlan, items: Purchase[]): string {
  const n = items.length;
  return [`EventPilot · ${plan.brief.title}`, `${n} decision${n > 1 ? "s need" : " needs"} you:`, ...items.map(line), "", help(plan)].join("\n");
}

export function statusText(plan: EventPlan): string {
  const a = plan.autopilot;
  if (!a) return `EventPilot · ${plan.brief.title}\nAutopilot hasn't run yet. Reply RUN to start it.`;
  const pending = a.purchases.filter((p) => p.status === "pending");
  const label: Record<string, string> = { awaiting_reply: "waiting for reply", negotiating: "negotiating", agreed: "agreed, needs your OK", booked: "booked", declined: "released", needs_you: "needs you" };
  const threads = a.threads ?? [];
  const picks = [
    ...threads.map((t) => `${t.category}: ${t.vendor} ${money(t.agreed ?? t.theirPrice ?? t.target)} (${label[t.status] ?? t.status})`),
    ...(a.shortlists ?? []).filter((s) => !threads.some((t) => t.category === s.category)).map((s) => `${s.category}: ${s.quotes[s.pick].vendor} (${money(s.quotes[s.pick].price)})`),
  ];
  return [
    `EventPilot · ${plan.brief.title}`,
    `${money(committed(a.purchases))} committed of ${money(a.mandate.totalCap)}.`,
    pending.length ? `Waiting on you:\n${pending.map(line).join("\n")}` : "Nothing is waiting on you.",
    ...(threads.some((t) => t.category === "Venue") && !threads.some((t) => t.category === "Venue" && (t.status === "booked" || t.status === "agreed")) ? ["No venue is locked yet. Text NEGOTIATE VENUE TO <price> to reopen talks."] : []),
    ...(picks.length ? [`Vendors: ${picks.join("; ")}.`] : []),
    help(plan),
  ].join("\n");
}

const YES = "yes|y|approve|approved|ok|okay|confirm";
const NO = "no|n|reject|decline|deny";
const STATUS = /^(\?|status|help|menu|commands|options|list|pending|next|whats next|what next|now what|what now|whats left|what can you do|what do you do|what needs me|whats pending|whats up|hi|hello|hey|start)$/;

export function applyReply(plan: EventPlan, text: string, via: string): { plan: EventPlan; reply: string; unknown?: boolean } {
  const a = plan.autopilot;
  if (!a) return { plan, reply: "Autopilot hasn't run yet, so there's nothing to decide." };
  const t = text.trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").replace(/(.)[.!?]+$/, "$1");
  const pending = a.purchases.filter((p) => p.status === "pending");
  let next: EventPlan = { ...plan, autopilot: { ...a, audit: appendAudit(a.audit, "organizer", "text_reply", `${via}: "${text.trim().slice(0, 80)}"`) } };
  const find = (id: string) => next.autopilot!.purchases.find((p) => p.id === id)!;
  const resolve = (items: Purchase[], approve: boolean) => {
    for (const p of items) next = decide(next, p.id, approve);
    const total = items.reduce((s, p) => s + p.amount, 0);
    return approve
      ? `Approved ${items.map((p) => `${ref(p)} ${p.vendor} ${money(p.amount)} on ${find(p.id).card}`).join("; ")}.${items.length > 1 ? ` Total ${money(total)}.` : ""}`
      : `Rejected ${items.map((p) => `${ref(p)} ${p.vendor}`).join(", ")}. Nothing was charged.${items.filter((p) => a.threads?.some((t) => t.purchaseId === p.id)).map((p) => ` I'll tell ${p.vendor} we're passing; to reopen, text NEGOTIATE ${p.category.toUpperCase()} TO <price>.`).join("")}`;
  };

  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^(?:all (${YES}|${NO})|(${YES}|${NO}) all|(approve|reject) all)$`)))) {
    const approve = new RegExp(`^(${YES})$`).test(m[1] ?? m[2] ?? m[3]);
    if (!pending.length) return { plan, reply: "Nothing is waiting on you right now." };
    const reply = resolve(pending, approve);
    return { plan: next, reply };
  }
  if ((m = t.match(new RegExp(`^(${YES}|${NO}) ?#?(\\d+)$`)))) {
    const approve = new RegExp(`^(${YES})$`).test(m[1]);
    const p = a.purchases.find((x) => refNum(x) === Number(m![2]));
    if (!p) return { plan, reply: `I can't find #${m[2]}. ${pending.length ? `Open: ${pending.map(ref).join(", ")}.` : "Nothing is waiting on you."}` };
    if (p.status !== "pending") return { plan, reply: `${ref(p)} ${p.vendor} is already ${p.status.replace("_", " ")}.` };
    const reply = resolve([p], approve);
    return { plan: next, reply };
  }
  if ((m = t.match(new RegExp(`^(${YES}|${NO})$`)))) {
    if (!pending.length) return { plan, reply: "Nothing is waiting on you right now." };
    if (pending.length > 1) return { plan, reply: `Which one? ${pending.map(ref).join(", ")} are open. Reply YES ${refNum(pending[0])} or ALL YES.` };
    const reply = resolve(pending, new RegExp(`^(${YES})$`).test(m[1]));
    return { plan: next, reply };
  }
  if ((m = t.match(/^(?:pick|switch|choose|use) ([a-z &]+?) #?(\d+)$/))) {
    const sl = (a.shortlists ?? []).find((s) => s.category.toLowerCase().startsWith(m![1]));
    if (!sl) return { plan, reply: `No quotes for "${m[1]}". Categories: ${(a.shortlists ?? []).map((s) => s.category).join(", ") || "none"}.` };
    const idx = Number(m[2]) - 1;
    if (idx < 0 || idx >= sl.quotes.length) return { plan, reply: `${sl.category} has quotes 1–${sl.quotes.length}.` };
    if (idx === sl.pick) return { plan, reply: `${sl.quotes[idx].vendor} is already the ${sl.category} pick.` };
    next = switchQuote(next, sl.category, idx);
    const p = next.autopilot!.purchases[next.autopilot!.purchases.length - 1];
    const q = sl.quotes[idx];
    const dep =
      p.status === "pending" ? `Deposit ${ref(p)} ${money(p.amount)} needs your OK: reply YES ${refNum(p)}.` : p.status === "auto_approved" ? `Deposit ${money(p.amount)} paid on ${p.card}.` : `Deposit blocked: ${p.reason}.`;
    return { plan: next, reply: `Switched ${sl.category} to ${q.vendor} (${money(q.price)}); the old deposit was released. ${dep}` };
  }
  if (STATUS.test(t)) return { plan, reply: statusText(plan) };
  return { plan, reply: `Sorry, I didn't catch that. ${help(plan)}`, unknown: true };
}

/** Compact, factual snapshot of the plan for answering free-form organizer questions. */
export function planContext(plan: EventPlan): string {
  const b = plan.brief;
  const a = plan.autopilot;
  const v = plan.venues[plan.selectedVenue] ?? plan.venues[0];
  const o = plan.ops;
  const L = [
    `This is the only event being run by text right now. If the organizer asks about a different event by name (not ${plan.brief.title}), say you're only running ${plan.brief.title} by text and they can text NEW plus a description to start that one; never answer with this event's vendors instead.`,
    `Event: ${b.title} · ${b.eventType} · ${b.city} · ${b.date} ${b.startTime} · ${b.durationHours}h · ${b.guests} guests · budget ${money(b.budget)} · vibe ${b.vibe}`,
    b.constraints.length ? `Constraints: ${b.constraints.join(", ")}` : "",
    v ? `Venue: ${v.name} (${v.neighborhood}, cap ${v.capacity}, ${money(v.pricePerHour)}/hr, ${v.indoor ? "indoor" : "outdoor"}). Why: ${v.why}` : "",
    plan.venues.length > 1 ? `Alternate venues: ${plan.venues.filter((x) => x !== v).map((x) => `${x.name} (cap ${x.capacity}, ${money(x.pricePerHour)}/hr)`).join("; ")}` : "",
    plan.weather ? `Weather: ${plan.weather.summary}` : "",
    `Budget: ${plan.budget.map((l) => `${l.category} ${money(l.amount)}`).join(", ")}`,
    `Schedule: ${plan.schedule.slice(0, 16).map((x) => `${x.day ? `D${x.day} ` : ""}${x.time} ${x.title}`).join("; ")}`,
    `Tasks: ${plan.tasks.filter((t) => t.done).length}/${plan.tasks.length} done. Next open: ${plan.tasks.filter((t) => !t.done).slice(0, 5).map((t) => `${t.title} (due ${t.due})`).join("; ") || "none"}`,
    plan.permits?.length ? `Permits: ${plan.permits.map((x) => `${x.name} – ${x.agency}, ${money(x.fee)}, file by ${x.deadline}${x.atRisk ? ", AT RISK" : ""}`).join("; ")}` : "",
    `Risks: ${plan.risks.map((r) => `[${r.level}] ${r.issue} → ${r.mitigation}`).join("; ")}. Plan confidence ${plan.score}/100.`,
    o ? `Staffing: ${o.staffing.map((x) => `${x.count} ${x.role}`).join(", ")}. Check-in: ${o.checkin.lanes} lanes, ~${o.checkin.minutes} min. Sponsor target ${money(o.sponsorTarget)}.` : "",
    o?.meals.length ? `Meals: ${o.meals.map((m) => `D${m.day} ${m.time} ${m.slot} ${m.servings} servings`).join("; ")}` : "",
  ];
  if (a) {
    L.push(
      `Spend mandate: total cap ${money(a.mandate.totalCap)}, per purchase ${money(a.mandate.perPurchaseCap)}, organizer approves above ${money(a.mandate.approvalThreshold)}, allowed ${a.mandate.allowedCategories.join(", ")}. Committed ${money(committed(a.purchases))}.`,
      `Purchases: ${a.purchases.map((p) => `${ref(p)} ${p.purpose} · ${p.vendor} · ${money(p.amount)} · ${p.status}${p.card ? ` · ${p.card}` : ""} (${p.reason})`).join("; ")}`,
      `Vendor email threads: ${(a.threads ?? []).map((t) => `${t.category} · ${t.vendor} · ${t.status}${t.agreed ? ` · agreed ${money(t.agreed)}` : t.theirPrice ? ` · they asked ${money(t.theirPrice)}` : ""}${t.offer ? ` · our offer ${money(t.offer)}` : ""}`).join("; ") || "none yet"}`,
      ...(a.shortlists ?? []).map(
        (sl) =>
          `${sl.category} quotes (pick #${sl.pick + 1}, why: ${sl.why}): ${sl.quotes.map((q, i) => `${i + 1}. ${q.vendor} ${money(q.price)}${q.listPrice && q.listPrice > q.price ? ` (negotiated from ${money(q.listPrice)})` : ""} ★${q.rating} ${q.leadDays}d lead ${q.cancellable ? "free cancel" : "non-refundable"}${q.tags.length ? ` [${q.tags.join(", ")}]` : ""}${q.note ? ` – ${q.note}` : ""}`).join("; ")}`,
      ),
      `Outbox: ${a.outbox.filter((m) => m.status === "draft").length} email/permit drafts awaiting approval (text SEND to send them all), ${a.outbox.filter((m) => m.status === "sent").length} sent.`,
    );
  }
  return L.filter(Boolean).join("\n");
}
