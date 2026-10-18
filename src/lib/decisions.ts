import type { EventPlan, Purchase } from "./types";
import { appendAudit, committed, decide, switchQuote } from "./autopilot";

/** Organizer decisions over text (Photon iMessage/SMS or the in-app simulated thread). Pure: plan in, plan + reply out. */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const refNum = (p: Purchase) => Number(p.id.replace(/^p/, "")) + 1;
const ref = (p: Purchase) => `#${refNum(p)}`;
const line = (p: Purchase) => `${ref(p)} ${p.purpose} · ${p.vendor} · ${money(p.amount)}`;
export function help(plan: EventPlan): string {
  const a = plan.autopilot;
  const first = a?.purchases.find((p) => p.status === "pending");
  const n = first ? refNum(first) : null;
  const sl = a?.shortlists?.[0];
  const pick = sl ? `PICK ${sl.category.toUpperCase()} ${((sl.pick + 1) % sl.quotes.length) + 1}, ` : "";
  return `Reply ${n ? `YES ${n}, NO ${n}, ALL YES, ` : ""}${pick}or STATUS.`;
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
  if (!a) return `EventPilot · ${plan.brief.title}\nAutopilot hasn't run yet.`;
  const pending = a.purchases.filter((p) => p.status === "pending");
  const picks = (a.shortlists ?? []).map((s) => `${s.category}: ${s.quotes[s.pick].vendor} (${money(s.quotes[s.pick].price)})`);
  return [
    `EventPilot · ${plan.brief.title}`,
    `${money(committed(a.purchases))} committed of ${money(a.mandate.totalCap)}.`,
    pending.length ? `Waiting on you:\n${pending.map(line).join("\n")}` : "Nothing is waiting on you.",
    ...(picks.length ? [`Vendors: ${picks.join("; ")}.`] : []),
    help(plan),
  ].join("\n");
}

const YES = "yes|y|approve|approved|ok|okay|confirm";
const NO = "no|n|reject|decline|deny";

export function applyReply(plan: EventPlan, text: string, via: string): { plan: EventPlan; reply: string } {
  const a = plan.autopilot;
  if (!a) return { plan, reply: "Autopilot hasn't run yet, so there's nothing to decide." };
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  const pending = a.purchases.filter((p) => p.status === "pending");
  let next: EventPlan = { ...plan, autopilot: { ...a, audit: appendAudit(a.audit, "organizer", "text_reply", `${via}: "${text.trim().slice(0, 80)}"`) } };
  const find = (id: string) => next.autopilot!.purchases.find((p) => p.id === id)!;
  const resolve = (items: Purchase[], approve: boolean) => {
    for (const p of items) next = decide(next, p.id, approve);
    const total = items.reduce((s, p) => s + p.amount, 0);
    return approve
      ? `Approved ${items.map((p) => `${ref(p)} ${p.vendor} ${money(p.amount)} on ${find(p.id).card}`).join("; ")}.${items.length > 1 ? ` Total ${money(total)}.` : ""}`
      : `Rejected ${items.map((p) => `${ref(p)} ${p.vendor}`).join(", ")}. Nothing was charged.`;
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
  if (/^(status|help|\?|hi|hello|hey|start)$/.test(t)) return { plan, reply: statusText(plan) };
  return { plan, reply: `Sorry, I didn't catch that. ${help(plan)}` };
}
