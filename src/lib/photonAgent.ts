import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { AgentEvent, EventPlan, TextMessage, VendorThread } from "./types";
import { discoverLink, isLinked, organizerReplies, photonConfig, textOrganizer } from "./photon";
import { applyReply, decisionText, planContext, refNum, untexted, help } from "./decisions";
import { mailConfig, sendEmail } from "./mailer";
import { fetchReplies } from "./mailbox";
import { answerVendor, interpret, matchThread, openThread, respond, followUps, settle, threadsText, type Effects, counterOffer, findThread } from "./vendorDeals";
import { sendMessage, isAutoDraft, appendAudit, committed, defaultMandate, emptyAutopilot, negotiatedSavings, planSteps } from "./autopilot";
import { runPlanner } from "./agents/orchestrator";
import { answerQuestion } from "./answer";
import { getLLMConfig } from "./llm";
import { buildSwarm, swarmText, SWARM_NAME, SWARM_VERSION } from "./swarm";
import { creaoConfig, runCreaoAgent } from "./creao";
import { thisWeekText } from "./workflow";
import { stakeholderText } from "./stakeholders";
import { attentionText, checkIn, dayOpsOf, headcount, localIso, postmortem, reportIncident, shiftSchedule, type IncidentCategory, type Severity } from "./dayops";
import { financeText, itemsOf, submitReimbursement, syncFinance } from "./finance";

/**
 * Server-side Photon agent: polls the organizer's iMessages and acts on them even when no browser is open.
 * It owns the "active" plan (persisted to .data/), which the web app syncs with.
 */

type State = { rev: number; plan: EventPlan | null; thread: TextMessage[]; since: number; seen: string[]; mailSeen?: string[] };
type Agent = { state: State; timer?: ReturnType<typeof setInterval>; polling: boolean; working: string | null; error?: string; notify?: ReturnType<typeof setTimeout>; mailTimer?: ReturnType<typeof setInterval>; mailPolling?: boolean; mailError?: string; webNotes?: string[]; webTimer?: ReturnType<typeof setTimeout>; sendTimer?: ReturnType<typeof setTimeout>; planning?: { title: string; prompt: string; events: AgentEvent[] } | null };

const FILE = path.join(process.cwd(), ".data", "photon-agent.json");
const g = globalThis as unknown as { __photonAgent?: Agent };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function load(): State {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as State;
  } catch {
    return { rev: 0, plan: null, thread: [], since: Date.now(), seen: [] };
  }
}
const agent = () => (g.__photonAgent ??= { state: load(), polling: false, working: null });
function save() {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(agent().state));
}
function setPlan(plan: EventPlan | null) {
  const s = agent().state;
  s.plan = plan;
  s.rev++;
  save();
}

export function snapshot() {
  const a = agent();
  return { rev: a.state.rev, plan: a.state.plan, thread: a.state.thread.slice(-80), working: a.working, error: a.error, linked: isLinked(), planning: a.planning ?? null };
}

/** Web app → server. Rejected (409) if the server changed since the client's last sync, so a text decision is never overwritten. */
export function pushPlan(plan: EventPlan, baseRev: number): boolean {
  if (baseRev !== agent().state.rev) return false;
  const prev = agent().state.plan;
  setPlan(plan);
  scheduleNotify();
  const runs = autonomous() && !plan.autopilot && prev?.id !== plan.id;
  if (photonConfig()) {
    if (prev?.id !== plan.id) announcePlan(plan, runs);
    else if (prev) queueWebUpdate(plan.brief.title, webChanges(prev, plan));
  }
  if (runs) setTimeout(() => void autoRun(plan.id), 5000);
  else if (autonomous() && plan.autopilot?.outbox.some(isAutoDraft)) scheduleWebSend();
  return true;
}

function announcePlan(plan: EventPlan, runs: boolean) {
  const b = plan.brief;
  const fresh = Date.now() - (Date.parse(plan.createdAt) || 0) < 15 * 60_000;
  const next = runs ? "The Ops Team starts running it now; I'll text you every update and each money decision." : plan.autopilot ? "Text STATUS for where it stands." : "Text RUN to start Autopilot.";
  void say(`${fresh ? "New event created on the website" : "Now working on"}: ${b.title}. ${b.guests.toLocaleString()} guests, ${b.city}, ${b.date}, ${money(b.budget)} budget${plan.venues[plan.selectedVenue] ? `, venue ${plan.venues[plan.selectedVenue].name}` : ""}. ${next}${link(" Watch live: ")}`, `new-${plan.id}-${Date.now()}`);
}

/** What the organizer changed on the website since the server's copy, in plain words. */
export function webChanges(prev: EventPlan, next: EventPlan): string[] {
  const out: string[] = [];
  const v = next.venues[next.selectedVenue];
  if (prev.selectedVenue !== next.selectedVenue && v) out.push(`Venue switched to ${v.name}`);
  const done = new Set(prev.tasks.filter((t) => t.done).map((t) => t.id));
  for (const t of next.tasks) if (t.done && !done.has(t.id)) out.push(`Task done: ${t.title}`);
  if (!prev.autopilot && next.autopilot) out.push("Autopilot started");
  else {
    const seen = new Set((prev.autopilot?.audit ?? []).map((e) => e.hash));
    for (const e of next.autopilot?.audit ?? []) if (!seen.has(e.hash)) out.push(e.detail);
  }
  if (!prev.dayops && next.dayops) out.push("Day-of ops plan is ready");
  else {
    const key = (l: { at: string; action: string; detail: string }) => `${l.at}|${l.action}|${l.detail}`;
    const seen = new Set((prev.dayops?.log ?? []).map(key));
    for (const l of [...(next.dayops?.log ?? [])].reverse()) if (!seen.has(key(l))) out.push(`Day-of: ${l.detail}`);
  }
  const seen = new Set((prev.finance?.activity ?? []).map((x) => x.id));
  if (prev.finance) for (const x of [...(next.finance?.activity ?? [])].reverse()) if (!seen.has(x.id)) out.push(`Finance: ${x.action} ${x.target}${x.detail ? ` (${x.detail})` : ""}`);
  return out;
}

function queueWebUpdate(title: string, notes: string[]) {
  if (!notes.length) return;
  const a = agent();
  a.webNotes = [...(a.webNotes ?? []), ...notes];
  clearTimeout(a.webTimer);
  a.webTimer = setTimeout(() => {
    const n = a.webNotes ?? [];
    a.webNotes = [];
    if (!n.length) return;
    const shown = n.slice(0, 5).map((x) => `• ${x.slice(0, 160)}`).join("\n");
    void say(`Update on ${title} from the website:\n${shown}${n.length > 5 ? `\n…and ${n.length - 5} more` : ""}${link("\nDetails: ")}`, `web-${Date.now()}`);
  }, 8000);
}

export function startPhotonAgent() {
  startMailAgent();
  const a = agent();
  if (a.timer || !photonConfig()) return;
  a.timer = setInterval(() => void tick(), 4000);
  void discoverLink().catch((e) => (a.error = errText(e))).finally(() => void tick());
}

async function say(text: string, key: string) {
  const a = agent();
  const k = key.replace(/[^\w-]/g, "").slice(0, 100);
  a.state.thread = [...a.state.thread, { id: `o-${k}`, dir: "out" as const, body: text, ts: Date.now(), via: "photon" as const }].slice(-200);
  save();
  try {
    const r = await textOrganizer(text, `ep-${k}`);
    if (r === "not_linked") a.error = `Text "hi" to the agent number first`;
  } catch (e) {
    a.error = errText(e);
  }
}

const errText = (e: unknown) => (e && typeof e === "object" && "status" in e ? `Photon API ${(e as { status: number }).status}` : "Photon request failed");

function scheduleNotify() {
  const a = agent();
  clearTimeout(a.notify);
  a.notify = setTimeout(() => void notifyDecisions(), 3000);
}

/** Texts any new pending purchases (e.g. after Autopilot runs in the web app or a vendor switch). */
async function notifyDecisions() {
  const p = agent().state.plan;
  if (!p?.autopilot || !photonConfig()) return;
  const items = untexted(p);
  if (!items.length) return;
  setPlan({ ...p, autopilot: { ...p.autopilot, texted: [...(p.autopilot.texted ?? []), ...items.map((x) => x.id)] } });
  const saved = negotiatedSavings(p.autopilot);
  const text = decisionText(p, items).replace(/\n\n(?=[^\n]*$)/, saved > 0 ? `\nI negotiated ${money(saved)} off vendor quotes.\n\n` : "\n\n");
  await say(text, `dec-${p.id.slice(0, 8)}-${items.map((x) => x.id).join("-")}`);
}

function runAutopilot(p: EventPlan): EventPlan {
  const mandate = p.autopilot?.mandate ?? defaultMandate(p);
  let a = p.autopilot ? { ...p.autopilot, mandate } : emptyAutopilot(mandate);
  let plan: EventPlan = { ...p, tasks: p.tasks.map((t) => ({ ...t })) };
  for (const step of planSteps(p, mandate, { awaitVendors: !!mailConfig() })) ({ a, plan } = step.apply(a, plan));
  return { ...plan, autopilot: a };
}

function planSummary(p: EventPlan) {
  const b = p.brief;
  const v = p.venues[p.selectedVenue];
  const risk = p.risks.find((r) => r.level === "high") ?? p.risks[0];
  return `${b.title} is planned: ${v ? `${v.name}, ` : ""}${b.date} at ${b.startTime}, ${b.guests.toLocaleString()} guests, ${money(b.budget)} budget. Confidence ${p.score}/100${risk ? `; top risk: ${risk.issue}` : ""}.\n${autonomous() ? "The Ops Team is taking it from here: emailing vendors and permit offices now. I'll text you for approvals." : "Reply RUN and I'll negotiate with vendors and book it, or ask me anything."}`;
}

const amounts = (s: string) => [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?(k\b)?/gi)].map((m) => parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));

/** Sanity check on a model-written text: every dollar figure must come from the plan or the question, otherwise drop it. */
function sane(ans: string | null, ctx: string, question: string): string | null {
  if (!ans) return null;
  const known = [...amounts(ctx), ...amounts(question), ...[...question.matchAll(/\b\d[\d,]*\b/g)].map((m) => parseFloat(m[0].replace(/,/g, "")))];
  const bad = amounts(ans).filter((n) => !known.some((k) => Math.abs(k - n) <= Math.max(1, k * 0.005)));
  if (bad.length) {
    console.warn(`[photon] sanity check blocked a reply with unverified amounts: ${bad.join(", ")}`);
    return null;
  }
  return ans;
}

function threadLine(t: VendorThread) {
  const price = t.agreed ?? t.theirPrice;
  return `${t.category}: ${t.vendor} · ${t.status.replace("_", " ")}${price ? ` at ${money(price)}` : ""}${t.offer && t.status === "negotiating" ? `, we offered ${money(t.offer)}` : ""}`;
}

function negotiationText(p: EventPlan, category?: string, recent: string[] = []) {
  const a = p.autopilot!;
  const sls = (a.shortlists ?? []).filter((s) => !category || s.category.toLowerCase().startsWith(category));
  const th = category ? findThread(p, category, recent) : undefined;
  if (category && th && (!sls.length || !sls.some((s) => s.category === th.category))) {
    const log = th.log.slice(-4).map((e) => `${e.dir === "out" ? "Me" : "Them"}: ${e.body.replace(/^Hi [^\n]*\n+/, "").replace(/\n*Best,[\s\S]*$/, "").replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
    return `${threadLine(th)}\n${log}\nTo counter, text NEGOTIATE ${th.category.toUpperCase()} TO <price>.`;
  }
  const extra = (a.threads ?? []).filter((t) => !sls.some((s) => s.category === t.category)).map(threadLine);
  if (!sls.length) return category ? `No quotes or vendor emails for "${category}". Categories: ${[...new Set([...(a.shortlists ?? []).map((s) => s.category), ...(a.threads ?? []).map((t) => t.category)])].join(", ")}.` : extra.length ? extra.join("\n") : "No vendor quotes yet.";
  if (category && sls.length === 1) {
    const q = sls[0].quotes[sls[0].pick];
    return `${sls[0].category} · ${q.vendor}\n${(q.rounds ?? []).map((r) => `${r.by === "agent" ? "Me" : "Them"}: ${r.note}`).join("\n") || "Not negotiated."}`;
  }
  const lines = sls.map((s) => {
    const q = s.quotes[s.pick];
    return q.listPrice && q.listPrice > q.price ? `${s.category}: ${q.vendor} ${money(q.listPrice)} → ${money(q.price)} (−${Math.round(((q.listPrice - q.price) / q.listPrice) * 100)}%)` : `${s.category}: ${q.vendor} ${money(q.price)}`;
  });
  return `Negotiated ${money(negotiatedSavings(a))} off in total.\n${[...lines, ...extra].join("\n")}\nText NEGOTIATE <CATEGORY> for the back-and-forth, or NEGOTIATE <CATEGORY> TO <price> to counter.`;
}

const link = (prefix: string) => (process.env.APP_URL ? `${prefix}${process.env.APP_URL}` : "");
const COMMANDS = [
  "EventPilot by text, start to finish:",
  "NEW <describe event>: plan a new event",
  "RUN: Autopilot gets quotes, negotiates and books",
  "SEND: email the vendor and permit drafts",
  "YES n / NO n / ALL YES: approve or reject a payment",
  "STATUS · VENDORS · NEGOTIATE <CATEGORY> TO <price>",
  "TASKS · DONE <n> · WHATS NEXT",
  "FINANCE · REIMBURSE <amount> <vendor> <what>",
  "ATTENTION · INCIDENT <what happened> · DELAY <item> <min> · CHECKIN <n>",
  "TEAM · CREAO · POSTMORTEM · LINK",
  "Or just ask a question.",
].join("\n");

const HELLO = `Hi, I'm EventPilot. Text PLAN and describe your event, e.g. "PLAN a 120-person founder mixer in SF next Friday, $15k". Then text RUN and I'll negotiate with vendors and book it, checking with you before big payments. Text HELP for every command.${link(" Watch progress at ")}`;

export async function handleInbound(text: string, id: string) {
  const a = agent();
  let n = 0;
  const reply = (s: string) => say(s, `in-${id}-${n++}`);
  const t = text.trim();
  const low = t.toLowerCase().replace(/[’']/g, "").replace(/[.!?]+$/, "");
  const since = a.state.plan ? Date.parse(a.state.plan.createdAt) || 0 : 0;
  const history = a.state.thread.slice(0, -1).filter((m) => m.ts >= since).slice(-7).map(({ dir, body }) => ({ dir, body }));

  if (/^(new|new (project|event|plan)|start (a )?new (project|event|plan)|plan|create( a)? (project|event))$/.test(low)) return reply(`Describe the event in one text, e.g. "NEW 120-person founder mixer in SF next Friday, $15k". I'll plan it, then run it with you by text.${link(" Watch it live at ")}`);
  const plan = t.match(/^(?:plan|new|new (?:project|event|plan)|start (?:a )?new (?:project|event|plan)|create (?:a )?(?:project|event)|organi[sz]e)\b[\s:,-]+([\s\S]{6,})$/i);
  if (plan) {
    if (a.planning) return reply(`Still planning ${a.planning.title}. I'll text you when it's ready.`);
    await reply(`On it. My crew is planning that now (${getLLMConfig() ? "2–3 minutes" : "a few seconds"}).${link(" Watch it live: ")} I'll text you the plan.`);
    a.working = "Planning a new event";
    a.planning = { title: plan[1].trim().slice(0, 60), prompt: plan[1].trim(), events: [] };
    try {
      const p = await runPlanner({ prompt: plan[1].trim() }, (e) => {
        if (a.planning && e.type !== "plan") a.planning.events = [...a.planning.events, e].slice(-120);
      });
      setPlan(p);
      await reply(`${planSummary(p)}${link("\nOpen it: ")}\nText HELP anytime for everything you can do by text.`);
      if (autonomous()) void autoRun(p.id);
    } catch {
      await reply("Sorry, planning failed. Try again, or plan it in the app.");
    } finally {
      a.working = null;
      a.planning = null;
    }
    return;
  }

  const p = a.state.plan;
  if (!p) return reply(HELLO);
  if (/^(help|commands|menu|what can you do|options)$/.test(low)) return reply(COMMANDS + link("\nWebsite: "));
  const log = (q: EventPlan, actor: string, action: string, detail: string) => (q.autopilot ? { ...q, autopilot: { ...q.autopilot, audit: appendAudit(q.autopilot.audit, actor, action, detail) } } : q);

  if (/^(run|run autopilot|autopilot|go|book it|book|start|do it)$/.test(low)) {
    await reply(`Running Autopilot on ${p.brief.title}: comparing 6 quotes per vendor, negotiating, then booking inside your spend limits…`);
    a.working = "Running Autopilot";
    const ran = log(runAutopilot(p), "organizer", "text_command", `iMessage: "${t.slice(0, 40)}"`);
    a.working = null;
    const ap = ran.autopilot!;
    const auto = ap.purchases.filter((x) => x.status === "auto_approved");
    const pending = ap.purchases.filter((x) => x.status === "pending" && !(ap.texted ?? []).includes(x.id));
    setPlan(ran);
    const saved = negotiatedSavings(ap);
    const drafted = ap.outbox.filter((m) => m.status === "draft" && /^(bookings|events)@/.test(m.to)).length;
    if (mailConfig()) {
      a.working = "Emailing vendors";
      const { sent, failed } = await sendAutoDrafts().finally(() => (a.working = null));
      await reply(`Done. Compared quotes and set a target price for each vendor${saved > 0 ? ` (${money(saved)} under list)` : ""}. Emailed ${sent} of ${drafted} vendors and permit offices${failed.length ? ` (${failed.length} failed: ${failed[0]})` : ""}; I check replies every 5 seconds, negotiate, and text you before any deposit.${pending.length ? ` ${pending.length} decision${pending.length === 1 ? "" : "s"} coming next.` : ""}`);
    } else await reply(
      `Done. ${saved > 0 ? `Negotiated ${money(saved)} off vendor quotes. ` : ""}Paid ${auto.length} deposit${auto.length === 1 ? "" : "s"} (${money(auto.reduce((s, x) => s + x.amount, 0))}) on single-use cards; ${money(committed(ap.purchases))} committed of ${money(ap.mandate.totalCap)}.${pending.length ? ` ${pending.length} need${pending.length === 1 ? "s" : ""} your OK, details next.` : " Nothing needs you."}`,
    );
    await notifyDecisions();
    return;
  }

  if (/^(this week|week|workflow|todo|to do|whats due|timeline|whats next|next|next steps|what now|whats left|what should i do)$/.test(low)) return reply(thisWeekText(p));
  if (/^(vendors|vendor emails|vendor status|inbox|emails|threads|replies)$/.test(low)) return reply(threadsText(p));
  if (/^(team|swarm|agents|org|raci|who decides)$/.test(low)) return reply(swarmText(p));
  if (/^(creao|creao review|audit|review)$/.test(low)) {
    if (!creaoConfig()) return reply("CREAO isn't connected on this server.");
    void creaoReview(p.id);
    return reply("Asked the CREAO Ops Team agent for an independent review. It takes about 3 minutes; I'll text you the verdict.");
  }
  if (/^(stakeholders?|perspectives?|(attendee|sponsor|vendor|organizer|guest)s?( view| side| experience)?)$/.test(low)) return reply(stakeholderText(p));
  if (/^(open( the)? app|app|link|url|website|where( is| do i see)? (it|the app))$/.test(low)) {
    return reply(process.env.APP_URL ? `Open EventPilot: ${process.env.APP_URL}` : "Open EventPilot in your browser where it's running (e.g. http://localhost:3000). Everything you do by text shows up there.");
  }
  if (/^(send|send all|send them|send it|send drafts|send emails|send the emails|do it for me|go ahead and send|file permits|file them)$/.test(low)) {
    const drafts = p.autopilot?.outbox.filter((m) => m.status === "draft") ?? [];
    if (!drafts.length) return reply(p.autopilot ? "Nothing to send: every email and permit draft is already out." : "No drafts yet. Text RUN and I'll prepare vendor emails and permit filings.");
    const mail = mailConfig();
    let q = log(p, "organizer", "text_command", `iMessage: "${t.slice(0, 40)}"`);
    const sent: typeof drafts = [], failed: string[] = [];
    const real = mail ? drafts.filter((m) => m.channel === "email").length : 0;
    if (real > 1) await reply(`Sending ${real} emails now from ${mail!.from}, all to ${mail!.redirect}. Should take about ${Math.max(5, Math.ceil(real / 4) * 2)} seconds.`);
    a.working = `Sending ${drafts.length} drafts`;
    try {
      const results = await Promise.all(drafts.map(async (m) => ({ m, r: mail && m.channel === "email" ? await sendEmail(m, p.brief.title) : null })));
      for (const { m, r } of results) {
        if (r && !r.ok) { failed.push(`${m.to}: ${r.error}`); continue; }
        if (r?.ok) q = openThread(log(q, "agent", "email_delivered", `${m.subject} → ${r.to} (written for ${m.to})`), m, r.messageId);
        q = sendMessage(q, m.id);
        sent.push(m);
      }
    } finally {
      a.working = null;
    }
    setPlan(q);
    const shown = sent.slice(0, 4).map((m) => `${m.subject} → ${m.to}`).join("; ");
    const how = mail ? `emailed for real from ${mail.from}, all redirected to ${mail.redirect}` : "simulated";
    const head = sent.length ? `Sent ${sent.length} draft${sent.length > 1 ? "s" : ""} (${how}): ${shown}${sent.length > 4 ? ` and ${sent.length - 4} more` : ""}.` : "Nothing went out.";
    return reply(`${head}${failed.length ? ` ${failed.length} failed and stay in drafts (${failed[0]}).` : ""} ${mail && sent.some((m) => /^(bookings|events)@/.test(m.to)) ? " I'll read the vendors' replies, negotiate, and text you when a deal needs your OK. Text VENDORS for status." : ""} Logged in the audit trail. Money still only moves on YES / PICK.`);
  }

  if (/^(tasks|checklist|todos|open tasks)$/.test(low)) {
    const open = p.tasks.map((x, i) => ({ x, i })).filter(({ x }) => !x.done);
    return reply(open.length ? `${open.length} open of ${p.tasks.length} tasks:\n${open.slice(0, 10).map(({ x, i }) => `${i + 1}. ${x.title} (${x.owner}, due ${x.due})`).join("\n")}${open.length > 10 ? `\n…and ${open.length - 10} more on the website.` : ""}\nText DONE <number> when one is finished.` : "Every task is done.");
  }
  const doneM = low.match(/^(?:done|did|finished|complete|completed|check off)\s+(?:task\s+)?#?(.+)$/);
  if (doneM) {
    const num = /^\d+$/.test(doneM[1]) ? parseInt(doneM[1], 10) - 1 : -1;
    const idx = num >= 0 ? num : p.tasks.findIndex((x) => !x.done && x.title.toLowerCase().includes(doneM[1]));
    const task = p.tasks[idx];
    if (!task) return reply(`No task matches "${doneM[1]}". Text TASKS for the numbered list.`);
    if (task.done) return reply(`"${task.title}" is already done.`);
    setPlan(log({ ...p, tasks: p.tasks.map((x, i) => (i === idx ? { ...x, done: true } : x)) }, "organizer", "task_done", `iMessage: ${task.title}`));
    const left = p.tasks.filter((x) => !x.done).length - 1;
    return reply(`Checked off "${task.title}". ${left} task${left === 1 ? "" : "s"} left.`);
  }
  const ciM = low.match(/^(?:check ?in|checked in|arrived)\s+\+?(\d+)$/);
  if (ciM) {
    try {
      const o = checkIn(dayOpsOf(p), parseInt(ciM[1], 10), "Organizer (text)");
      setPlan({ ...p, dayops: o });
      const h = headcount(o);
      return reply(`Checked in ${ciM[1]}: ${h.checkedIn.toLocaleString()} of ${h.registered.toLocaleString()} here. Meal counts now follow actual check-ins. Text ATTENTION for anything short.`);
    } catch (e) {
      return reply(e instanceof Error ? e.message : "Couldn't record that check-in.");
    }
  }
  if (/^(postmortem|post-mortem|retro|wrap up|wrap-up|recap)$/.test(low)) {
    const o = dayOpsOf(p);
    const report = postmortem(p, o);
    setPlan({ ...p, dayops: { ...o, postmortemAt: localIso(new Date()) } });
    return reply(`${report.slice(0, 1400)}${report.length > 1400 ? "\n…full report on the website." : ""}`);
  }
  const rbM = t.match(/^reimburse(?:ment)?\s+\$?([\d,]+(?:\.\d{1,2})?)\s+(?:(?:at|from|to)\s+)?(\S+)\s*(?:for\s+)?([\s\S]*)$/i);
  if (rbM) {
    const amount = parseFloat(rbM[1].replace(/,/g, ""));
    const f = p.finance ?? syncFinance(p);
    const items = f.categories.flatMap(itemsOf);
    const words = `${rbM[2]} ${rbM[3]}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const item = items.find((it) => words.some((w) => `${it.name} ${it.vendor}`.toLowerCase().includes(w))) ?? items.find((it) => /contingency|suppl|misc/i.test(it.name)) ?? items[0];
    if (!item || !(amount > 0)) return reply("Text it like: REIMBURSE 85 Costco snacks for volunteers.");
    const next = submitReimbursement(f, { name: "Organizer", email: "", team: "Organizer", itemId: item.id, vendor: rbM[2], purchaseDate: new Date().toISOString().slice(0, 10), amount, description: rbM[3] || rbM[2], receiptName: "", firstReimbursement: false, payee: true });
    const r = next.reimbursements[0];
    setPlan(log({ ...p, finance: next }, "organizer", "reimbursement", `${r.id} ${money(amount)} ${rbM[2]}`));
    return reply(`Submitted ${r.id}: ${money(amount)} at ${rbM[2]}, charged to ${item.name}. Receipt check: ${r.check.verdict.toUpperCase()}${r.check.verdict !== "pass" ? ` (${r.check.checks.filter((c) => c.result !== "pass").map((c) => c.label).slice(0, 2).join("; ")})` : ""}. Attach the receipt on the website's Budget tab; finance and director approval happen there. Payout is simulated.`);
  }
  if (/^(attention|ops|day of|day-of|dayof|day of ops|alerts|issues|whats wrong)$/.test(low)) return reply(attentionText(p));
  if (/^(finance|money|reimbursements?|budget requests?)$/.test(low)) return reply(financeText(p));
  const incM = t.trim().match(/^incident[:\s]+([\s\S]+)$/i);
  if (incM) {
    let rest = incM[1].trim();
    const sevM = rest.match(/\b(critical|urgent|high|medium|low)\b/i);
    const severity = (sevM ? sevM[1].toLowerCase().replace("urgent", "critical") : "medium") as Severity;
    const catM = rest.match(/^(medical|security|conduct|facilities|lost[ _-]?(?:and[ _-])?found|other)\b/i);
    const l2 = rest.toLowerCase();
    const category: IncidentCategory = catM
      ? (/^lost/i.test(catM[1]) ? "lost_found" : (catM[1].toLowerCase() as IncidentCategory))
      : /medic|faint|injur|hurt|bleed|allerg|sick|ambulance|seizure|unconscious/.test(l2) ? "medical"
      : /secur|fight|theft|stolen|intruder|weapon|threat/.test(l2) ? "security"
      : /harass|conduct|inappropriate/.test(l2) ? "conduct"
      : /power|wi-?fi|internet|leak|spill|toilet|restroom|outlet|hvac|broken|trash|facilit/.test(l2) ? "facilities"
      : /lost|found|missing/.test(l2) ? "lost_found" : "other";
    if (catM) rest = rest.slice(catM[0].length).trim();
    if (sevM && rest.toLowerCase().startsWith(sevM[1].toLowerCase())) rest = rest.slice(sevM[1].length).trim();
    if (!rest) return reply("Say what happened, e.g. INCIDENT medical attendee fainted near stage.");
    const r = reportIncident(dayOpsOf(p), { category, severity, description: rest, reportedBy: "Organizer (text)" });
    setPlan(log({ ...p, dayops: r.ops }, "organizer", "incident_reported", `#${r.incident.id} ${severity} ${category}: ${rest.slice(0, 60)}`));
    return reply(`Logged incident #${r.incident.id}: ${severity} ${category.replace("_", " ")}. Routed to ${r.incident.owner}${severity === "critical" ? `, escalated to ${r.ops.director}` : ""}.${category === "medical" && /critical|high/.test(severity) ? " If anyone is in danger, call 911 first." : ""} Text ATTENTION for everything open.`);
  }
  const delM = low.match(/^(?:delay|shift)\s+(.+?)\s+(?:by\s+)?(-?\d+)\s*(?:m|min|mins|minutes)?(?:\s+(only|rest of (?:the )?day))?$/);
  if (delM) {
    const mins = parseInt(delM[2], 10);
    if (!mins || Math.abs(mins) > 240) return reply("Give a delay between 1 and 240 minutes, e.g. DELAY LUNCH 15.");
    const o = dayOpsOf(p);
    const term = delM[1].replace(/^the\s+/, "");
    const nowL = localIso(new Date());
    const hits = o.ros.filter((r) => r.title.toLowerCase().includes(term));
    const item = hits.find((r) => r.endsAt >= nowL) ?? hits[0];
    if (!item) return reply(`No run-of-show item matches "${term}". Try one of: ${o.ros.slice(0, 6).map((r) => r.title).join(", ")}.`);
    const scope = delM[3] === "only" ? "item" : "day";
    const s = shiftSchedule(o, item.id, mins, scope, "Organizer (text)");
    setPlan(log({ ...p, dayops: s.ops }, "organizer", "schedule_shift", `${item.title} ${mins > 0 ? "+" : ""}${mins} min (${scope})`));
    const flagged = s.mealsFlagged.map((mid) => s.ops.meals.find((m) => m.id === mid)!);
    return reply(`Moved ${item.title}${scope === "day" && s.shifted > 1 ? ` and the ${s.shifted - 1} item${s.shifted > 2 ? "s" : ""} after it that day` : ""} by ${mins > 0 ? "+" : ""}${mins} min; linked announcements moved too.${flagged.length ? ` Tell ${[...new Set(flagged.map((m) => m.vendor))].join(", ")} the new time for ${flagged.map((m) => m.meal).join(", ")}.` : ""}${scope === "day" ? " Add ONLY to move just this item." : ""}`);
  }
  const amt = (x: string) => parseFloat(x.replace(/[$,]/g, "")) * (/k$/.test(x) ? 1000 : 1);
  const ctr = low.match(/^(?:negotiate|counter|offer|ask|get|bring|make|push|try)\s+(?:(.+?)\s+)?(?:down\s+)?(?:(?:to|for|at)\s+)?(\$?[\d,]+(?:\.\d+)?k?)(?:\s+(?:instead|total|please|now|confirm))*$/);
  const ctr2 = low.match(/^(\$?[\d,]+(?:\.\d+)?k?)\s+(?:for|on)\s+(.+)$/);
  const bare = low.match(/^(\$?[\d,]+(?:\.\d+)?k?)(?:\s+(?:instead|total|confirm))*$/);
  const cm = ctr ? { term: ctr[1], price: amt(ctr[2]) } : ctr2 ? { term: ctr2[2].replace(/\s+confirm$/, ""), price: amt(ctr2[1]) } : bare ? { term: undefined, price: amt(bare[1]) } : null;
  if (cm && cm.price >= 50 && p.autopilot?.threads?.length) {
    const th = findThread(p, cm.term, history.slice(-6).map((h) => h.body));
    if (!th) return reply(`I don't have a vendor conversation matching "${cm.term}". Text VENDORS to see them.`);
    const fx = counterOffer(p, th.id, cm.price, /\bconfirm$/.test(low));
    const msg = fx.texts.join(" ");
    await applyEffects({ ...fx, texts: [] }, `ctr-${id}`);
    return reply(msg);
  }
  const neg = low.match(/^(?:negotiate|negotiation|savings|deals?)(?:\s+([a-z &]+?))?(?:\s+(?:now|please|again))?$/);
  if (neg) return reply(p.autopilot ? negotiationText(p, neg[1]?.trim(), history.map((h) => h.body)) : "I haven't negotiated yet. Text RUN and I'll get quotes and haggle first.");

  if (!p.autopilot) {
    if (/^(status|help|\?|hi|hello|hey|start|whats next|what next)$/.test(low)) return reply(planSummary(p));
    if (/^(yes|no|y|n|approve|reject|all yes|pick|switch)\b/.test(low)) return reply("Autopilot hasn't run yet, so there's nothing to approve. Text RUN to start it.");
    const ctx = planContext(p);
    const ans = sane(await answerQuestion(t, ctx, history), ctx, t);
    return reply(ans ?? planSummary(p));
  }

  const r = applyReply(p, t, "iMessage");
  if (r.unknown) {
    a.working = "Thinking";
    const ctx = planContext(p);
    const ans = sane(await answerQuestion(t, ctx, history), ctx, t);
    a.working = null;
    const cur = agent().state.plan ?? p;
    setPlan(log(log(cur, "organizer", "text_question", `iMessage: "${t.slice(0, 80)}"`), "agent", "text_answer", ans ? `answered: "${ans.slice(0, 80)}"` : "no model; sent command help"));
    return reply(ans ?? `${planSummary(p)}\n${help(p)}`);
  }
  const ap = r.plan.autopilot!;
  const asked = ap.purchases.filter((x) => x.status === "pending" && r.reply.includes(`#${refNum(x)} `)).map((x) => x.id);
  setPlan(asked.length ? { ...r.plan, autopilot: { ...ap, texted: [...new Set([...(ap.texted ?? []), ...asked])] } } : r.plan);
  await reply(r.reply);
  scheduleNotify();
}

async function tick() {
  const a = agent();
  if (a.polling || !photonConfig()) return;
  a.polling = true;
  try {
    const msgs = await organizerReplies(new Date(a.state.since - 5000));
    a.error = undefined;
    for (const m of msgs) {
      if (a.state.seen.includes(m.id)) continue;
      a.state.seen = [...a.state.seen, m.id].slice(-300);
      a.state.since = Math.max(a.state.since, m.ts);
      a.state.thread = [...a.state.thread, { id: m.id, dir: "in" as const, body: m.text, ts: m.ts, via: "photon" as const }].slice(-200);
      save();
      await handleInbound(m.text, m.id);
    }
  } catch (e) {
    a.error = errText(e);
  } finally {
    a.polling = false;
  }
}

// ---- Real vendor email: read replies, negotiate, follow up, confirm ----

export function mailStatus() {
  const a = agent();
  return { watching: !!a.mailTimer, threads: a.state.plan?.autopilot?.threads?.length ?? 0, mailError: a.mailError };
}

function startMailAgent() {
  const a = agent();
  if (a.mailTimer || !mailConfig()) return;
  a.mailTimer = setInterval(() => void mailTick(), Math.max(5, Number(process.env.VENDOR_POLL_SECONDS || 5)) * 1000);
  setTimeout(() => void mailTick(), 3000);
}

const followMinutes = () => Math.max(1, Number(process.env.VENDOR_FOLLOWUP_MINUTES || 1440));

function addMessageId(plan: EventPlan, threadId: string, id: string): EventPlan {
  const ap = plan.autopilot!;
  return { ...plan, autopilot: { ...ap, threads: (ap.threads ?? []).map((x) => (x.id === threadId && !x.messageIds.includes(id) ? { ...x, messageIds: [...x.messageIds, id] } : x)) } };
}

async function mailTick() {
  const a = agent();
  if (a.mailPolling || !a.state.plan?.autopilot?.threads?.length) return;
  a.mailPolling = true;
  try {
    const replies = await fetchReplies(new Set(a.state.mailSeen ?? []));
    a.mailError = undefined;
    for (const r of replies) {
      a.state.mailSeen = [...(a.state.mailSeen ?? []), r.messageId].slice(-500);
      save();
      const p = a.state.plan;
      if (!p?.autopilot) break;
      const t = matchThread(p, r);
      if (!t || !r.text) continue;
      const parsed = await interpret(r.text, t.log.filter((e) => e.dir === "out").at(-1)?.body ?? "");
      const answer = parsed.question ? await answerVendor(p, t, parsed.question) : undefined;
      const cur = agent().state.plan;
      if (!cur?.autopilot) break;
      const fx = respond(cur, t.id, r.text, parsed, answer);
      await applyEffects({ ...fx, plan: addMessageId(fx.plan, t.id, r.messageId) }, `vr-${r.messageId}`);
    }
    if (a.state.plan?.autopilot) await applyEffects(followUps(a.state.plan, Date.now(), followMinutes()), `fu-${Date.now()}`);
    if (a.state.plan?.autopilot) await applyEffects(settle(a.state.plan), `st-${Date.now()}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "mail check failed";
    if (msg !== a.mailError && /invalid login|credentials|auth/i.test(msg))
      void say("Heads up: Gmail is rejecting EventPilot's login, so vendor emails can't be sent or read. Create a new App Password at myaccount.google.com/apppasswords and update the server.", `mailauth-${new Date().toISOString().slice(0, 13)}`);
    a.mailError = msg;
  } finally {
    a.mailPolling = false;
  }
}

async function applyEffects(fx: Effects, key: string) {
  if (!fx.emails.length && !fx.texts.length && fx.plan === agent().state.plan) return;
  setPlan(fx.plan);
  for (const e of fx.emails) {
    const p = agent().state.plan!;
    const t = p.autopilot?.threads?.find((x) => x.id === e.threadId);
    if (!t) continue;
    const r = await sendEmail({ to: t.to, subject: t.subject, body: e.body }, p.brief.title, { reply: true, inReplyTo: t.messageIds.at(-1), references: t.messageIds.slice(-10) });
    const cur = agent().state.plan!;
    const ap = cur.autopilot!;
    const next = r.ok ? addMessageId(cur, t.id, r.messageId) : cur;
    setPlan({ ...next, autopilot: { ...next.autopilot!, audit: appendAudit(ap.audit, "negotiator", r.ok ? "email_delivered" : "email_failed", `Re: ${t.subject} → ${r.ok ? r.to : r.error} (for ${t.to})`) } });
  }
  for (const id of fx.send ?? []) await deliverDraft(id);
  if (fx.texts.length) await say(fx.texts.join("\n\n"), key);
  scheduleNotify();
}

/** Sends one outbox draft from the active plan (real email when configured) and starts tracking vendor replies. */
async function deliverDraft(id: string): Promise<{ ok: boolean; error?: string }> {
  const p = agent().state.plan;
  const m = p?.autopilot?.outbox.find((x) => x.id === id);
  if (!p || !m) return { ok: false, error: "draft not found" };
  if (m.status === "sent") return { ok: true };
  let messageId: string | undefined, to: string | undefined;
  if (m.channel === "email" && mailConfig()) {
    const r = await sendEmail(m, p.brief.title);
    if (!r.ok) return { ok: false, error: r.error };
    messageId = r.messageId;
    to = r.to;
  }
  let q = sendMessage(agent().state.plan!, m.id);
  if (messageId) {
    q = { ...q, autopilot: { ...q.autopilot!, audit: appendAudit(q.autopilot!.audit, "agent", "email_delivered", `${m.subject} → ${to} (written for ${m.to})`) } };
    q = openThread(q, m, messageId);
  }
  setPlan(q);
  return { ok: true };
}

/** Web "Approve & send": sends one outbox message from the active plan. */
export async function sendOutbox(planId: string, id: string): Promise<{ ok: boolean; error?: string; plan?: EventPlan; rev?: number } | null> {
  const p = agent().state.plan;
  if (p?.id !== planId || !p.autopilot?.outbox.some((x) => x.id === id)) return null;
  const r = await deliverDraft(id);
  return r.ok ? { ok: true, plan: agent().state.plan!, rev: agent().state.rev } : { ok: false, error: r.error };
}

/** Emails every vendor quote request and permit filing still waiting in the outbox. */
async function sendAutoDrafts(): Promise<{ sent: number; failed: string[] }> {
  const ids = agent().state.plan?.autopilot?.outbox.filter(isAutoDraft).map((m) => m.id) ?? [];
  let sent = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const r = await deliverDraft(id);
    if (r.ok) sent++;
    else failed.push(r.error ?? "failed");
  }
  return { sent, failed };
}

/** Autopilot run on the website: send its vendor emails right away instead of leaving them as drafts. */
function scheduleWebSend() {
  const a = agent();
  clearTimeout(a.sendTimer);
  a.sendTimer = setTimeout(async () => {
    if (a.working) return void scheduleWebSend();
    a.working = "Emailing vendors";
    try {
      const { sent, failed } = await sendAutoDrafts();
      if (sent || failed.length) await say(`Autopilot on the website: emailed ${sent} vendors and permit offices${failed.length ? ` (${failed.length} failed: ${failed[0]})` : ""}. I'll negotiate their replies and text you each decision.`, `ws-${Date.now()}`);
    } finally {
      a.working = null;
    }
    await notifyDecisions();
  }, 3000);
}

// ---- Autonomous mode: the Ops Team runs a new plan end to end; only money approvals go to the organizer ----

const autonomous = () => process.env.AUTONOMOUS !== "0" && !!mailConfig();

async function autoRun(planId: string) {
  const a = agent();
  const p = a.state.plan;
  if (!p || p.id !== planId || p.autopilot || a.working) return;
  a.working = "Ops Team running";
  try {
    const ran = runAutopilot(p);
    setPlan({ ...ran, autopilot: { ...ran.autopilot!, audit: appendAudit(ran.autopilot!.audit, "exec", "autonomous_run", `${SWARM_NAME} v${SWARM_VERSION} took over ${p.brief.title}`) } });
    const { sent, failed } = await sendAutoDrafts();
    const cur = agent().state.plan!;
    await say(
      `${SWARM_NAME} v${SWARM_VERSION} is running ${cur.brief.title} on its own: ${sent} vendor and permit emails sent${failed.length ? ` (${failed.length} failed: ${failed[0]})` : ""}. It negotiates replies, follows up and switches vendors by itself, and texts you only for money approvals. ${buildSwarm(cur).approval} Text TEAM, VENDORS or STATUS anytime.`,
      `auto-${planId.slice(0, 8)}`,
    );
  } finally {
    a.working = null;
  }
  await notifyDecisions();
  void creaoReview(planId);
}

/** Independent review by the hosted CREAO Ops Team agent (runs in the background, ~3 min). */
async function creaoReview(planId: string) {
  const p = agent().state.plan;
  if (!p || p.id !== planId || !creaoConfig()) return;
  const slim = { brief: p.brief, budget: p.budget, vendors: p.vendors, permits: p.permits?.map((x) => ({ name: x.name, deadline: x.deadline, fee: x.fee })), purchases: p.autopilot?.purchases.map((x) => ({ vendor: x.vendor, amount: x.amount, status: x.status })), threads: p.autopilot?.threads?.map((t) => ({ vendor: t.vendor, category: t.category, status: t.status, agreed: t.agreed })) };
  const r = await runCreaoAgent({ plan: JSON.stringify(slim).slice(0, 12000), swarm: JSON.stringify(buildSwarm(p)).slice(0, 8000) });
  const cur = agent().state.plan;
  if (!cur || cur.id !== planId) return;
  if (!r.ok) {
    if (cur.autopilot) setPlan({ ...cur, autopilot: { ...cur.autopilot, audit: appendAudit(cur.autopilot.audit, "exec", "creao_review_failed", r.error) } });
    return;
  }
  let summary = r.text.slice(0, 500);
  try {
    const j = JSON.parse(r.text) as Record<string, unknown>;
    summary = [j.summary, j.flags_raised, j.open_decisions].filter((x) => typeof x === "string" && x).join(" · ").slice(0, 600) || summary;
  } catch {
    /* plain-text answer */
  }
  const next: EventPlan = { ...cur, creao: { runId: r.runId, ts: Date.now(), summary, text: r.text.slice(0, 8000) } };
  setPlan(next.autopilot ? { ...next, autopilot: { ...next.autopilot, audit: appendAudit(next.autopilot.audit, "exec", "creao_review", summary.slice(0, 200)) } } : next);
  await say(`CREAO Ops Team review of ${cur.brief.title}: ${summary}`, `creao-${r.runId.slice(0, 8)}`);
}
