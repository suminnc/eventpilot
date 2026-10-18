import { chatJSON, getLLMConfig, type LLMConfig } from "../llm";
import { applyFeedbackOffline, parseBriefOffline } from "../parse";
import { billableHours, venueSearchTool, weatherTool } from "../tools";
import type {
  AgentEvent,
  AgentId,
  BudgetLine,
  EventBrief,
  EventPlan,
  Risk,
  ScheduleItem,
  Task,
  Vendor,
  Venue,
  Weather,
} from "../types";

type Emit = (e: AgentEvent) => void;

export type PlanRequest = {
  prompt: string;
  brief?: Partial<EventBrief>;
  feedback?: string;
  previous?: EventPlan;
};

type Ctx = { llm: LLMConfig | null; emit: Emit; feedback?: string };

const now = () => Date.now();

async function step<T>(ctx: Ctx, agent: AgentId, start: string, fn: () => Promise<T>, done: (r: T) => string): Promise<T> {
  const t0 = now();
  ctx.emit({ type: "agent_start", agent, message: start, ts: t0 });
  const r = await fn();
  ctx.emit({ type: "agent_done", agent, message: done(r), ms: now() - t0, ts: now() });
  return r;
}

const think = (ctx: Ctx, agent: AgentId, message: string) => ctx.emit({ type: "thought", agent, message, ts: now() });

async function tool<T>(ctx: Ctx, agent: AgentId, name: string, input: string, fn: () => Promise<T> | T, summarize: (r: T) => string) {
  ctx.emit({ type: "tool_call", agent, tool: name, input, ts: now() });
  const r = await fn();
  ctx.emit({ type: "tool_result", agent, tool: name, output: summarize(r), ts: now() });
  return r;
}

/** Try the LLM; on any failure fall back to the deterministic implementation. */
async function withLLM<T>(ctx: Ctx, agent: AgentId, offline: () => T, online?: (llm: LLMConfig) => Promise<T>): Promise<T> {
  if (!ctx.llm || !online) return offline();
  try {
    return await online(ctx.llm);
  } catch (err) {
    think(ctx, agent, `LLM call failed (${(err as Error).message.slice(0, 80)}); using built-in planner.`);
    return offline();
  }
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const briefJSON = (b: EventBrief) => JSON.stringify({ ...b, prompt: undefined });
const fb = (ctx: Ctx) => (ctx.feedback ? `\nUser refinement request (highest priority): "${ctx.feedback}"` : "");

// ---------------------------------------------------------------- Coordinator
async function coordinator(ctx: Ctx, req: PlanRequest): Promise<EventBrief> {
  return step(ctx, "coordinator", "Reading your request and extracting the event brief…", async () => {
    let base: EventBrief;
    if (req.previous && req.feedback) {
      think(ctx, "coordinator", `Applying refinement: “${req.feedback}”`);
      base = applyFeedbackOffline(req.previous.brief, req.feedback);
    } else {
      base = parseBriefOffline(req.prompt, req.brief);
    }
    const brief = await withLLM(ctx, "coordinator", () => base, async (llm) => {
      const out = await chatJSON<Partial<EventBrief>>(
        llm,
        `You are the Coordinator agent of an event-planning crew. Extract a structured brief.
Fields: eventType, title (catchy, <=6 words), city, date (YYYY-MM-DD, future), startTime (HH:mm 24h), durationHours (number), guests (number), budget (USD number), vibe (short phrase), constraints (string[]).
Today is ${new Date().toISOString().slice(0, 10)}. Keep any field the user did not mention equal to the draft.`,
        `User request: ${req.prompt}${req.feedback ? `\nRefinement: ${req.feedback}` : ""}\nDraft brief: ${briefJSON(base)}`,
        { temperature: 0.2 },
      );
      return sanitizeBrief({ ...base, ...out, prompt: base.prompt });
    });
    think(ctx, "coordinator", `Delegating to Venue Scout + Logistics in parallel, then Budget & Scheduler, then Comms, then Critic review.`);
    return brief;
  }, (b) => `${b.title}: ${b.guests} guests · ${money(b.budget)} · ${b.date} ${b.startTime} · ${b.city}`);
}

function sanitizeBrief(b: EventBrief): EventBrief {
  return {
    ...b,
    guests: Math.max(1, Math.round(Number(b.guests) || 1)),
    budget: Math.max(0, Math.round(Number(b.budget) || 0)),
    durationHours: Math.min(72, Math.max(1, Number(b.durationHours) || 3)),
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : parseBriefOffline("").date,
    startTime: /^\d{2}:\d{2}$/.test(b.startTime) ? b.startTime : "18:00",
    constraints: Array.isArray(b.constraints) ? b.constraints.map(String) : [],
  };
}

// ---------------------------------------------------------------- Venue Scout
async function scout(ctx: Ctx, brief: EventBrief): Promise<Venue[]> {
  return step(ctx, "scout", `Searching venues in ${brief.city} for ${brief.guests} guests…`, async () => {
    const maxHourly = (brief.budget * 0.35) / billableHours(brief.durationHours);
    think(ctx, "scout", `Venue should stay under ~35% of budget → ≤ ${money(maxHourly)}/hr.`);
    const found = await tool(
      ctx, "scout", "venue_search",
      JSON.stringify({ city: brief.city, type: brief.eventType, vibe: brief.vibe, guests: brief.guests, maxHourly: Math.round(maxHourly) }),
      () => venueSearchTool(brief.city, brief.eventType, brief.vibe, brief.guests, maxHourly),
      (r) => r.map((v) => `${v.name} (${v.capacity} cap, ${money(v.pricePerHour)}/hr)`).join("; "),
    );
    return withLLM(ctx, "scout",
      () => found.map((v) => ({ ...v, why: offlineWhy(v, brief, maxHourly) })),
      async (llm) => {
        const out = await chatJSON<{ venues: { name: string; why: string }[] }>(
          llm,
          `You are the Venue Scout agent. Rank the candidate venues best-first for the brief and write a punchy 1-2 sentence "why" for each referencing capacity, cost, and vibe. Return {"venues":[{"name","why"}]} using only the given names.`,
          `Brief: ${briefJSON(brief)}${fb(ctx)}\nCandidates: ${JSON.stringify(found)}`,
        );
        const ranked = out.venues
          .map((o) => { const v = found.find((f) => f.name === o.name); return v && { ...v, why: o.why }; })
          .filter(Boolean) as Venue[];
        return ranked.length ? ranked : found.map((v) => ({ ...v, why: offlineWhy(v, brief, maxHourly) }));
      });
  }, (v) => `Top pick: ${v[0]?.name ?? "none"} (+${Math.max(0, v.length - 1)} alternates)`);
}

function offlineWhy(v: Venue, b: EventBrief, maxHourly: number) {
  const fit = v.capacity >= b.guests ? `fits ${b.guests} guests with room to spare (cap ${v.capacity})` : `is tight on capacity (${v.capacity})`;
  const cost = v.pricePerHour <= maxHourly ? `keeps venue spend at ${money(v.pricePerHour * billableHours(b.durationHours))}` : `is a stretch at ${money(v.pricePerHour * billableHours(b.durationHours))}`;
  return `${v.style} in ${v.neighborhood} that ${fit} and ${cost}.`;
}

// ---------------------------------------------------------------- Budget Analyst
const SPLITS: Record<string, [string, number][]> = {
  hackathon: [["Food & drinks", 0.38], ["Prizes", 0.18], ["Swag", 0.1], ["AV & Wi-Fi", 0.08], ["Staffing & security", 0.06], ["Marketing", 0.04]],
  wedding: [["Catering & bar", 0.4], ["Photo & video", 0.12], ["Music / DJ", 0.08], ["Florals & decor", 0.1], ["Attire & beauty", 0.06]],
  default: [["Food & drinks", 0.4], ["Decor & ambiance", 0.1], ["Entertainment", 0.12], ["AV & equipment", 0.06], ["Supplies & misc", 0.06]],
};

async function budgetAgent(ctx: Ctx, brief: EventBrief, venue: Venue | undefined): Promise<BudgetLine[]> {
  return step(ctx, "budget", `Allocating ${money(brief.budget)} across categories…`, async () => {
    const hrs = billableHours(brief.durationHours);
    const venueCost = venue ? venue.pricePerHour * hrs : brief.budget * 0.25;
    const lines = await tool(ctx, "budget", "budget_calculator", JSON.stringify({ total: brief.budget, venueCost, guests: brief.guests }), () => {
      const contingency = Math.round(brief.budget * 0.08);
      const remaining = Math.max(0, brief.budget - venueCost - contingency);
      const split = SPLITS[brief.eventType] || SPLITS.default;
      const totalW = split.reduce((s, [, w]) => s + w, 0);
      const out: BudgetLine[] = [{ category: "Venue", amount: Math.round(venueCost), note: venue ? `${venue.name}, ${hrs} billable h @ ${money(venue.pricePerHour)}/hr` : "Estimated" }];
      for (const [c, w] of split) {
        const amt = Math.round((remaining * w) / totalW);
        out.push({ category: c, amount: amt, note: c.startsWith("Food") || c.startsWith("Catering") ? `≈ ${money(amt / brief.guests)} per guest` : "" });
      }
      out.push({ category: "Contingency", amount: contingency, note: "8% buffer for surprises" });
      return out;
    }, (r) => r.map((l) => `${l.category} ${money(l.amount)}`).join(", "));
    if (venueCost > brief.budget * 0.5) think(ctx, "budget", `Venue eats ${Math.round((venueCost / brief.budget) * 100)}% of budget — flagging for Critic.`);
    think(ctx, "budget", "Budget math stays deterministic so totals always reconcile to the dollar.");
    return lines;
  }, (l) => `${l.length} line items · per-guest ≈ ${money(brief.budget / brief.guests)}`);
}

// ---------------------------------------------------------------- Scheduler
function addMin(hhmm: string, m: number) {
  const [h, mm] = hhmm.split(":").map(Number);
  const t = (h * 60 + mm + m + 24 * 60 * 10) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// [offset hours from start (for reference length), duration min, title, detail]
const TEMPLATES: Record<string, { length: number; items: [number, number, string, string][] }> = {
  hackathon: {
    length: 36,
    items: [
      [-2, 90, "Crew load-in & Wi-Fi stress test", "Tables, power drops, signage, check-in kiosks"],
      [0, 120, "Check-in & breakfast", "QR badge pickup, team-formation board, coffee bar"],
      [2, 60, "Opening ceremony", "Tracks & prizes, sponsor intros, rules, code of conduct"],
      [3, 15, "Hacking begins", "Mentor queue opens; sponsor expo tables staffed"],
      [4, 60, "Lunch", "Dietary-labeled stations (veg/vegan/halal/GF)"],
      [5, 240, "Workshop block", "Intro to agents, shipping with Devin, sponsor API deep-dives"],
      [10, 75, "Dinner", "Staggered by table zone to avoid lines"],
      [14, 45, "Midnight mini-event", "Lightning talks / cup stacking + late snack"],
      [15, 360, "Overnight hacking", "Quiet room & nap area open; security rounds; mentor on-call"],
      [22, 60, "Breakfast", "Coffee bar + submission reminder"],
      [26, 60, "Lunch", "Devpost submission checklist on screens"],
      [27, 0, "Submissions close", "Code freeze; table numbers assigned"],
      [28, 180, "Expo judging", "Science-fair style judging rounds; sponsor judging"],
      [32, 120, "Closing ceremony & awards", "Finalist demos, prizes, photos"],
      [35, 60, "Teardown", "Volunteer sweep, vendor load-out"],
    ],
  },
  default: {
    length: 4,
    items: [
      [-1.5, 90, "Setup & vendor arrival", "Crew load-in, AV check, signage"],
      [0, 30, "Doors open & welcome", "Greeters, check-in, welcome drink"],
      [0.5, 45, "Mingling", "Background music, passed bites"],
      [1.25, 45, "Main program", "Toast / talk / headline moment"],
      [2, 60, "Food service", "Dinner or food stations open"],
      [3, 45, "Activity / entertainment", "DJ, games or performance"],
      [3.75, 15, "Wrap-up & thank-yous", "Group photo, send-off"],
    ],
  },
};

async function scheduler(ctx: Ctx, brief: EventBrief, venue: Venue | undefined): Promise<ScheduleItem[]> {
  return step(ctx, "scheduler", `Drafting a ${brief.durationHours}h run-of-show…`, async () => {
    const tpl = TEMPLATES[brief.eventType] || TEMPLATES.default;
    const scale = brief.durationHours / tpl.length;
    const [sh, sm] = brief.startTime.split(":").map(Number);
    const draft: ScheduleItem[] = tpl.items.map(([offset, dur, title, detail]) => {
      const t = Math.round((offset * scale * 60) / 5) * 5;
      const abs = sh * 60 + sm + t;
      return {
        day: Math.max(1, Math.floor(abs / 1440) + 1),
        time: addMin(brief.startTime, t),
        durationMin: Math.max(dur ? 10 : 0, Math.round((dur * Math.min(scale, 1.5)) / 5) * 5),
        title,
        detail: venue && /load-in|Setup/.test(title) ? `${detail} at ${venue.name}` : detail,
      };
    });
    return withLLM(ctx, "scheduler", () => draft, async (llm) => {
      const out = await chatJSON<{ schedule: ScheduleItem[] }>(
        llm,
        `You are the Scheduler agent. Produce a realistic, specific run-of-show for the event starting at startTime and lasting durationHours. 6-14 items. Each: day (1-based, for multi-day events), time (HH:mm 24h), durationMin, title, detail (specific, actionable), owner (role). Return {"schedule":[...]}.`,
        `Brief: ${briefJSON(brief)}\nVenue: ${venue?.name ?? "TBD"}${fb(ctx)}\nDraft: ${JSON.stringify(draft)}`,
      );
      const s = out.schedule?.filter((i) => /^\d{1,2}:\d{2}$/.test(i.time) && i.title);
      return s?.length ? s.map((i) => ({ ...i, day: Number(i.day) || 1, time: i.time.padStart(5, "0"), durationMin: Number(i.durationMin) || 30 })) : draft;
    });
  }, (s) => `${s.length} blocks from ${s[0]?.time} to ${s.length ? addMin(s[s.length - 1].time, s[s.length - 1].durationMin) : "?"}`);
}

// ---------------------------------------------------------------- Logistics
async function logistics(ctx: Ctx, brief: EventBrief, budget: BudgetLine[], venue: Venue | undefined, weather: Weather): Promise<{ vendors: Vendor[]; tasks: Task[] }> {
  return step(ctx, "logistics", "Lining up vendors and building the task timeline…", async () => {
    const food = budget.find((b) => /food|catering/i.test(b.category))?.amount ?? brief.budget * 0.35;
    const vendors: Vendor[] = [
      { category: "Catering", suggestion: brief.guests > 150 ? "Full-service caterer with buffet stations" : "Local restaurant family-style catering", estCost: Math.round(food), contactTip: `Ask for a per-head quote for ${brief.guests}${brief.constraints.length ? ` incl. ${brief.constraints.join(", ")}` : ""}.` },
      { category: "AV", suggestion: brief.eventType === "hackathon" ? "Venue AV + rented mesh Wi-Fi & power strips" : "PA system, wireless mic, projector", estCost: Math.round(brief.budget * 0.06), contactTip: "Confirm bandwidth / power drops per table." },
      { category: "Photography", suggestion: "Freelance event photographer (2–3h coverage)", estCost: Math.min(1200, Math.round(brief.budget * 0.05)), contactTip: "Share the run-of-show so they catch key moments." },
    ];
    if (venue && !venue.indoor) vendors.push({ category: "Rentals", suggestion: "Tent/canopy + heaters on standby", estCost: Math.round(brief.budget * 0.04), contactTip: "Book with a free-cancellation window 72h out." });
    const days = Math.round((new Date(brief.date).getTime() - Date.now()) / 86_400_000);
    const due = (before: number) => {
      const d = new Date(brief.date);
      d.setDate(d.getDate() - Math.min(before, Math.max(0, days)));
      return d.toISOString().slice(0, 10);
    };
    const list: [string, number, Task["priority"], string, AgentId][] = [
      [`Place hold on ${venue?.name ?? "venue"} & sign contract`, Math.max(21, Math.round(days * 0.8)), "high", "Organizer", "scout"],
      ["Send save-the-date / open registration", Math.max(14, Math.round(days * 0.7)), "high", "Comms lead", "comms"],
      ["Collect catering quotes (3) and book", Math.max(14, Math.round(days * 0.6)), "high", "Ops lead", "logistics"],
      ["Book AV and photographer", Math.max(10, Math.round(days * 0.5)), "medium", "Ops lead", "logistics"],
      ["Finalize run-of-show & roles", 7, "medium", "Organizer", "scheduler"],
      ["Send reminder + logistics email", 3, "medium", "Comms lead", "comms"],
      ["Confirm final headcount with caterer", 3, "high", "Ops lead", "budget"],
      ["Day-of kit: signage, badges, extension cords, first aid", 1, "low", "Volunteers", "logistics"],
    ];
    if ((weather.precipChance ?? 0) >= 30 && venue && !venue.indoor) list.push(["Trigger rain plan decision", 2, "high", "Organizer", "logistics"]);
    if (brief.eventType === "hackathon") list.push(["Lock judging rubric & sponsor prize list", 10, "high", "Organizer", "logistics"]);
    const tasks: Task[] = list
      .map(([title, before, priority, owner, agent], i) => ({ id: `t${i}`, title, due: due(before), owner, priority, done: false, agent }))
      .sort((a, b) => a.due.localeCompare(b.due));
    return withLLM(ctx, "logistics", () => ({ vendors, tasks }), async (llm) => {
      const out = await chatJSON<{ vendors: Vendor[] }>(
        llm,
        `You are the Logistics agent. Make the vendor list specific to the city/event (realistic vendor types or well-known local options), keep estCost consistent with the budget. Return {"vendors":[{"category","suggestion","estCost","contactTip"}]}.`,
        `Brief: ${briefJSON(brief)}\nWeather: ${weather.summary}\nBudget: ${JSON.stringify(budget)}${fb(ctx)}\nDraft vendors: ${JSON.stringify(vendors)}`,
      );
      return { vendors: out.vendors?.length ? out.vendors.map((v) => ({ ...v, estCost: Number(v.estCost) || 0 })) : vendors, tasks };
    });
  }, (r) => `${r.vendors.length} vendors · ${r.tasks.length} tasks scheduled`);
}

// ---------------------------------------------------------------- Comms
async function comms(ctx: Ctx, brief: EventBrief, venue: Venue | undefined): Promise<EventPlan["invite"]> {
  return step(ctx, "comms", "Writing the invite and SMS reminder…", async () => {
    const when = new Date(`${brief.date}T${brief.startTime}`).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    const where = venue ? `${venue.name}, ${venue.neighborhood}` : brief.city;
    const offline = {
      subject: `You're invited: ${brief.title} — ${when.split(" at ")[0]}`,
      body: `Hi there!\n\nWe'd love for you to join us for ${brief.title}, a ${brief.vibe} ${brief.eventType}.\n\nWhen: ${when}\nWhere: ${where}\n${brief.constraints.length ? `Good to know: ${brief.constraints.join(", ")}\n` : ""}\nPlease RSVP by replying to this email so we can plan food and space.\n\nSee you there!`,
      sms: `Reminder: ${brief.title} is ${when} at ${where}. Reply YES to confirm or NO if plans changed.`,
    };
    return withLLM(ctx, "comms", () => offline, async (llm) => {
      const out = await chatJSON<EventPlan["invite"]>(
        llm,
        `You are the Comms agent. Write a warm, on-brand invite email (subject + body, <=150 words, include when/where/RSVP) and a <=160 char SMS reminder matching the vibe. Return {"subject","body","sms"}.`,
        `Brief: ${briefJSON(brief)}\nWhen: ${when}\nWhere: ${where}${fb(ctx)}`,
        { temperature: 0.8 },
      );
      return out.subject && out.body ? { subject: out.subject, body: out.body, sms: out.sms || offline.sms } : offline;
    });
  }, (i) => `Drafted “${i.subject.slice(0, 60)}”`);
}

// ---------------------------------------------------------------- Critic
async function critic(ctx: Ctx, plan: Omit<EventPlan, "risks" | "score" | "summary">): Promise<{ risks: Risk[]; score: number; summary: string }> {
  return step(ctx, "critic", "Stress-testing the plan for risks…", async () => {
    const { brief, venues, selectedVenue, budget, weather, tasks } = plan;
    const venue = venues[selectedVenue];
    const risks: Risk[] = [];
    if (!venue) risks.push({ level: "high", issue: "No venue matched the brief", mitigation: "Loosen capacity or budget constraints, or consider a split venue." });
    else {
      if (venue.capacity < brief.guests) risks.push({ level: "high", issue: `${venue.name} holds ${venue.capacity}, below ${brief.guests} guests`, mitigation: "Pick the next alternate or cap registrations." });
      const share = (budget.find((b) => b.category === "Venue")?.amount ?? 0) / Math.max(1, brief.budget);
      if (share > 0.45) risks.push({ level: "medium", issue: `Venue is ${Math.round(share * 100)}% of budget`, mitigation: "Negotiate a weekday/off-peak rate or shorten the booking window." });
      if (!venue.indoor && (weather?.precipChance ?? 0) >= 25) risks.push({ level: "high", issue: `Outdoor venue with ${weather?.precipChance}% rain chance`, mitigation: "Reserve a tent or indoor backup now; decide 48h out." });
      else if (!venue.indoor) risks.push({ level: "low", issue: "Outdoor venue — weather dependent", mitigation: "Keep a canopy rental on free-cancellation hold." });
    }
    const perGuest = brief.budget / brief.guests;
    if (perGuest < 20) risks.push({ level: "medium", issue: `Only ${money(perGuest)} per guest`, mitigation: "Seek sponsors, go potluck/food-truck, or trim headcount." });
    const days = Math.round((new Date(brief.date).getTime() - Date.now()) / 86_400_000);
    if (days < 14) risks.push({ level: "high", issue: `Only ${Math.max(0, days)} days of lead time`, mitigation: "Book venue + catering today; send invites within 24h." });
    if (brief.guests > 100) risks.push({ level: "low", issue: "Large headcount — check-in bottleneck", mitigation: "Use QR check-in and two lines staffed by volunteers." });
    if (brief.constraints.length) risks.push({ level: "low", issue: `Constraints to verify: ${brief.constraints.join(", ")}`, mitigation: "Get written confirmation from venue/caterer." });
    void tasks;
    const score = Math.max(35, 100 - risks.reduce((s, r) => s + (r.level === "high" ? 18 : r.level === "medium" ? 9 : 3), 0));
    const offline = {
      risks,
      score,
      summary: `${brief.title} is a ${brief.vibe} ${brief.eventType} for ${brief.guests} in ${brief.city} on ${brief.date}. ${venue ? `Recommended venue: ${venue.name}.` : ""} Budget of ${money(brief.budget)} works out to ${money(perGuest)}/guest. ${weather ? `Weather: ${weather.summary}.` : ""}`,
    };
    return withLLM(ctx, "critic", () => offline, async (llm) => {
      const out = await chatJSON<{ risks: Risk[]; summary: string }>(
        llm,
        `You are the Critic agent. Review the event plan, keep the detected risks and add up to 2 non-obvious ones. Be concise. Note: multi-day venues are billed at a day rate (~12 billable hours/day); that is intentional, not an error. Do not re-flag detected risks (level high|medium|low, issue, mitigation). Also write a confident 2-3 sentence executive summary. Return {"risks":[...],"summary":"..."}.`,
        `Plan: ${JSON.stringify({ brief, venue, budget, weather, schedule: plan.schedule })}${fb(ctx)}\nDetected risks: ${JSON.stringify(risks)}`,
        { temperature: 0.4 },
      );
      const extra = (Array.isArray(out.risks) ? out.risks : []).filter((x) => x.issue && !risks.some((r) => r.issue === x.issue)).slice(0, 2);
      // Rule-detected risks drive the score; model-suggested ones count at half weight.
      const penalty = extra.reduce((s, x) => s + (x.level === "high" ? 9 : x.level === "medium" ? 4 : 1), 0);
      return { risks: [...risks, ...extra], score: Math.max(35, score - penalty), summary: out.summary || offline.summary };
    });
  }, (r) => `Plan confidence ${r.score}/100 · ${r.risks.filter((x) => x.level === "high").length} high-priority risks`);
}

// ---------------------------------------------------------------- Orchestrator
export async function runPlanner(req: PlanRequest, emit: Emit): Promise<EventPlan> {
  const llm = getLLMConfig();
  const ctx: Ctx = { llm, emit, feedback: req.feedback };
  think(ctx, "coordinator", llm ? `Using ${llm.model} for reasoning.` : "No LLM key configured — running the built-in offline planner (real weather tool still live).");

  const brief = await coordinator(ctx, req);

  const [venues, weather] = await Promise.all([
    scout(ctx, brief),
    tool(ctx, "logistics", "weather_forecast", `${brief.city} on ${brief.date}`, () => weatherTool(brief.city, brief.date), (w) => `${w.summary}${w.highC != null ? `, high ${Math.round(w.highC)}°C` : ""}`),
  ]);
  let selectedVenue = 0;
  if ((weather.precipChance ?? 0) >= 40) {
    const indoor = venues.findIndex((v) => v.indoor);
    if (indoor > 0) {
      selectedVenue = indoor;
      think(ctx, "scout", `Rain risk ${weather.precipChance}% → switching pick to indoor ${venues[indoor].name}.`);
    }
  }
  const venue = venues[selectedVenue];

  const [budget, schedule] = await Promise.all([budgetAgent(ctx, brief, venue), scheduler(ctx, brief, venue)]);
  const [{ vendors, tasks }, invite] = await Promise.all([logistics(ctx, brief, budget, venue, weather), comms(ctx, brief, venue)]);

  const draft = {
    id: req.previous?.id ?? crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    brief,
    venues,
    selectedVenue,
    budget,
    schedule,
    tasks,
    vendors,
    weather,
    invite,
    mode: llm ? ("llm" as const) : ("offline" as const),
    model: llm?.model ?? "offline-heuristics",
  };
  const review = await critic(ctx, draft);
  if (llm) think(ctx, "coordinator", `Done: ${llm.usage.calls} model calls, ${llm.usage.promptTokens.toLocaleString()} input + ${llm.usage.completionTokens.toLocaleString()} output tokens.`);
  return { ...draft, ...review, usage: llm ? { ...llm.usage } : undefined };
}
