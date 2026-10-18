import type { EventPlan } from "./types";
import { buildWorkflow } from "./workflow";

/** Reviews a plan from each stakeholder's point of view and lists what they need and what would bother them. */

export type Persona = "Organizer" | "Sponsor" | "Vendor" | "Attendee";
export type Need = { label: string; ok: boolean; detail: string };
export type Issue = { level: "high" | "medium" | "low"; issue: string; fix: string };
export type View = { persona: Persona; goal: string; score: number; needs: Need[]; issues: Issue[] };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

function score(issues: Issue[]) {
  return Math.max(0, 100 - issues.reduce((s, i) => s + (i.level === "high" ? 18 : i.level === "medium" ? 8 : 3), 0));
}

export function stakeholderViews(plan: EventPlan): View[] {
  const b = plan.brief;
  const ops = plan.ops;
  const venue = plan.venues[plan.selectedVenue];
  const all = `${b.prompt} ${b.constraints.join(" ")} ${b.eventType}`.toLowerCase();
  const hackathon = /hack/.test(all);
  const overnight = b.durationHours >= 12;
  const w = buildWorkflow(plan);
  const views: View[] = [];

  // Organizer: decisions, deadlines, money, risk.
  {
    const a = plan.autopilot;
    const pending = a?.purchases.filter((p) => p.status === "pending") ?? [];
    const late = w.gates.filter((g) => g.status === "overdue" || g.status === "past");
    const spend = plan.budget.reduce((s, l) => s + l.amount, 0);
    const atRisk = plan.permits?.filter((p) => p.atRisk) ?? [];
    const highRisks = plan.risks.filter((r) => r.level === "high");
    const issues: Issue[] = [];
    if (w.daysOut < 0) issues.push({ level: "high", issue: `The date (${b.date}) has already passed`, fix: "Pick a new date, e.g. Refine: \"move it to next Friday\"" });
    if (pending.length) issues.push({ level: "medium", issue: `${pending.length} payment decision${pending.length > 1 ? "s" : ""} waiting on you`, fix: "Approve or reject in Autopilot, or text YES n / NO n" });
    if (late.length) issues.push({ level: late.length > 5 ? "high" : "medium", issue: `${late.length} milestone${late.length > 1 ? "s" : ""} past the normal date`, fix: "Work the catch-up plan in the Plan of action tab; text THIS WEEK for the short list" });
    if (atRisk.length && !highRisks.some((r) => /permit/i.test(r.issue))) issues.push({ level: "high", issue: `${atRisk.length} permit${atRisk.length > 1 ? "s" : ""} can't clear in normal lead time`, fix: "Call each agency today and ask for expedited review" });
    if (spend > b.budget * 1.001) issues.push({ level: "high", issue: `Budget lines total ${money(spend)}, over the ${money(b.budget)} budget`, fix: "Refine: \"make it 10% cheaper\"" });
    highRisks.slice(0, 3).forEach((r) => issues.push({ level: "high", issue: r.issue.length > 110 ? `${r.issue.slice(0, r.issue.lastIndexOf(";", 110) > 40 ? r.issue.lastIndexOf(";", 110) : 107)}…` : r.issue, fix: r.mitigation }));
    views.push({
      persona: "Organizer",
      goal: "Ship the event on time and on budget, with no surprises",
      score: score(issues),
      issues,
      needs: [
        { label: "One owner per workstream", ok: w.teams.length > 0, detail: w.teams.map((t) => t.name).join(", ") },
        { label: "Budget fits", ok: spend <= b.budget * 1.001, detail: `${money(spend)} planned of ${money(b.budget)}` },
        { label: "Spend guardrails", ok: !!a, detail: a ? `Auto-approve under ${money(a.mandate.approvalThreshold)}, cap ${money(a.mandate.totalCap)}` : "Run Autopilot to set the spend mandate" },
        { label: "Decisions reach you anywhere", ok: true, detail: "Decision texts over Photon; replies apply to the plan" },
      ],
    });
  }

  // Sponsor: only when the event sells sponsorships.
  if (ops && ops.sponsors.length) {
    const sched = plan.schedule.map((s) => `${s.title} ${s.detail}`.toLowerCase()).join(" | ");
    const stage = /opening|kickoff|welcome|keynote/.test(sched);
    const workshops = /workshop|tech talk|demo/.test(sched);
    const expo = /expo|booth|career|fair|sponsor/.test(sched);
    const closing = /closing|awards|demo|judging/.test(sched);
    const issues: Issue[] = [];
    if (!expo) issues.push({ level: "high", issue: "No sponsor expo or booth time on the schedule", fix: "Add a 2–3h expo block when attendance peaks (after the first meal)" });
    if (!workshops && hackathon) issues.push({ level: "medium", issue: "No workshop slots for sponsor tech talks", fix: "Reserve 4–8 workshop slots in breakout rooms" });
    if (!stage) issues.push({ level: "medium", issue: "No opening-ceremony stage time for top tiers", fix: "Give Anchor/Gold sponsors 1–2 minutes in the opening" });
    if (!closing) issues.push({ level: "low", issue: "No awards moment for sponsor prize tracks", fix: "Announce sponsor prizes at closing" });
    const reach = b.guests;
    issues.push({ level: "low", issue: "Sponsors will ask for proof of return afterwards", fix: "Track booth scans, workshop attendance, prize-track submissions and resume-book opt-ins; send a report within a week" });
    views.push({
      persona: "Sponsor",
      goal: `Reach ${reach.toLocaleString()} ${hackathon ? "developers" : "attendees"}: hiring, brand and product adoption`,
      score: score(issues),
      issues,
      needs: [
        { label: "Clear tiers and price", ok: true, detail: ops.sponsors.map((s) => `${s.tier} ${money(s.price)}`).join(" · ") },
        { label: "Face time with attendees", ok: expo, detail: expo ? "Expo/booth time on the schedule" : "Missing from the schedule" },
        { label: "Stage or workshop slot", ok: stage || workshops, detail: [stage && "opening stage", workshops && "workshops"].filter(Boolean).join(", ") || "None yet" },
        { label: "One POC + deliverables checklist", ok: true, detail: "Logo, survey, booth needs, promo dates, resume book, guest passes" },
        { label: "Post-event report", ok: false, detail: "Metrics and thank-you within a week" },
      ],
    });
  }

  // Vendor: a spec they can quote, a window they can deliver to, and terms they get paid on.
  {
    const meals = ops?.meals ?? [];
    const sl = plan.autopilot?.shortlists ?? [];
    const leadMiss = sl.flatMap((s) => s.quotes.filter((q) => q.leadDays > Math.max(0, w.daysOut)).map((q) => `${q.vendor} (${s.category})`));
    const dayOf = ops?.contacts.find((c) => !/911|emergenc|medical|police|fire/i.test(`${c.role} ${c.owner}`));
    const hasContact = !!dayOf;
    const issues: Issue[] = [];
    if (w.daysOut >= 0 && w.daysOut < 14) issues.push({ level: "high", issue: `Only ${w.daysOut} days of lead time: many vendors will decline or charge rush fees`, fix: "Lock headcounts now and accept rush terms only in writing" });
    if (leadMiss.length) issues.push({ level: "medium", issue: `${leadMiss.length} quoted vendor${leadMiss.length > 1 ? "s" : ""} can't deliver in time`, fix: "Autopilot already skips them; don't negotiate with them" });
    if (meals.length && !meals.every((m) => Object.keys(m.split).length > 1)) issues.push({ level: "medium", issue: "Some meals lack a dietary split", fix: "Send per-meal counts by diet with the order" });
    if (!hasContact) issues.push({ level: "medium", issue: "No day-of contact for deliveries", fix: "Name a receiver with a phone number for every delivery" });
    if (b.guests >= 150) issues.push({ level: "low", issue: "Venue delivery rules (dock, windows, liftgate) must be shared up front", fix: "Include the load-in sheet with every order" });
    views.push({
      persona: "Vendor",
      goal: "A clear order, an easy delivery and on-time payment",
      score: score(issues),
      issues,
      needs: [
        { label: "Written spec", ok: true, detail: `${b.guests.toLocaleString()} guests${meals.length ? `, ${meals.length} meal slots with diet counts` : ""}` },
        { label: "Delivery window", ok: meals.length > 0 || b.guests < 20, detail: meals.length ? `Arrive 30 min before each meal (first: ${meals[0].time})` : "Agree a window when booking" },
        { label: "Load-in and venue rules", ok: !!venue, detail: venue ? `${venue.name}, ${venue.neighborhood}${b.guests >= 1000 ? " · load-in the day before" : ""}` : "Venue TBD" },
        { label: "Day-of contact", ok: hasContact, detail: dayOf ? `${dayOf.role}: ${dayOf.owner}` : "Not set" },
        { label: "Payment terms", ok: true, detail: "Deposit ≤50% by card, balance on delivery; COI if they bring equipment" },
      ],
    });
  }

  // Attendee: the journey from invite to follow-up.
  {
    const issues: Issue[] = [];
    const lane = ops?.checkin;
    if (lane && lane.minutes > 45) issues.push({ level: "high", issue: `Check-in takes ~${lane.minutes} min to clear`, fix: "Add lanes or staggered arrival windows; pre-send QR codes" });
    else if (lane && lane.minutes > 20) issues.push({ level: "low", issue: `Check-in rush takes ~${lane.minutes} min to clear`, fix: "Stagger arrival windows and pre-send QR codes so nobody waits long" });
    const sorted = [...plan.schedule].sort((x, y) => (x.day ?? 1) - (y.day ?? 1) || mins(x.time) - mins(y.time));
    const mealIdx = sorted.map((s, i) => [s, i] as const).filter(([s]) => /breakfast|lunch|dinner|meal|snack|food|brunch/i.test(s.title));
    let gap = 0;
    for (let i = 1; i < mealIdx.length; i++) {
      const p = mealIdx[i - 1][0], c = mealIdx[i][0];
      gap = Math.max(gap, ((c.day ?? 1) - (p.day ?? 1)) * 1440 + mins(c.time) - mins(p.time));
    }
    if (b.durationHours >= 6 && mealIdx.length === 0) issues.push({ level: "high", issue: `${b.durationHours}h event with no food on the schedule`, fix: "Add meals or snacks every 4–5 hours" });
    if (gap > 6 * 60 && !overnight) issues.push({ level: "medium", issue: `Longest stretch without food: ${Math.round(gap / 60)}h`, fix: "Add a snack break" });
    if (gap > 8 * 60 && overnight) issues.push({ level: "medium", issue: `Longest stretch without food: ${Math.round(gap / 60)}h (overnight)`, fix: "Add a midnight snack and early coffee" });
    const diets = ["vegetarian", "vegan", "halal", "gluten", "kosher", "nut", "dairy"].filter((d) => all.includes(d));
    const access = /ada|accessib|wheelchair/.test(all);
    const transit = /transit|bart|muni|train|subway|bus/.test(all);
    const outdoor = venue && !venue.indoor;
    const rain = (plan.weather?.precipChance ?? 0) >= 40;
    if (outdoor && rain) issues.push({ level: "high", issue: `${plan.weather!.precipChance}% chance of rain at an outdoor venue`, fix: "Book a tent or move indoors" });
    if (!access && b.guests >= 50) issues.push({ level: "medium", issue: "Accessibility not specified", fix: "Confirm step-free entry, accessible restrooms and seating; ask about needs at RSVP" });
    if (overnight && !(ops?.infra.some((i) => /sleep|rest|quiet/i.test(i.item)))) issues.push({ level: "medium", issue: "No rest space for an overnight event", fix: "Set aside a quiet sleep room with lights dimmed" });
    if (hackathon && !(ops?.infra.some((i) => /wi-?fi|network/i.test(i.item)))) issues.push({ level: "high", issue: "No Wi-Fi plan for a hackathon", fix: "Size Wi-Fi to 2–3 devices per hacker" });
    views.push({
      persona: "Attendee",
      goal: hackathon ? "Build something great, meet people, eat well and get some rest" : "Have a great time without friction",
      score: score(issues),
      issues,
      needs: [
        { label: "Invite with the essentials", ok: !!plan.invite.body, detail: "Time, place, what to bring, how to get there" },
        { label: "Getting there", ok: transit || !!venue, detail: venue ? `${venue.neighborhood}${transit ? " · near transit" : ""}` : "Venue TBD" },
        { label: "Fast check-in", ok: !lane || lane.minutes <= (b.guests > 500 ? 45 : 20), detail: lane ? `${lane.lanes} lanes, ~${lane.minutes} min to clear the rush` : "Small event: greet at the door" },
        { label: "Food for every diet", ok: diets.length > 0 || b.guests < 20, detail: diets.length ? diets.join(", ") : "Ask about dietary needs at RSVP" },
        { label: "Accessible", ok: access, detail: access ? "ADA requirements in the brief" : "Not specified yet" },
        { label: "Follow-up", ok: false, detail: "Thank-you, photos and a 2-minute feedback survey within 48h" },
      ],
    });
  }
  return views;
}

export function stakeholderText(plan: EventPlan): string {
  const lines = stakeholderViews(plan).map((v) => {
    const top = v.issues.find((i) => i.level === "high") ?? v.issues.find((i) => i.level === "medium") ?? v.issues[0];
    return `${v.persona} ${v.score}/100${top ? `: ${top.issue}. Fix: ${top.fix}` : ": nothing flagged"}`;
  });
  return `${plan.brief.title} through everyone's eyes:\n${lines.join("\n")}`;
}
