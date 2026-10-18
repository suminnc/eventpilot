import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { EventPlan, TextMessage } from "./types";
import { discoverLink, isLinked, organizerReplies, photonConfig, textOrganizer } from "./photon";
import { applyReply, decisionText, planContext, refNum, untexted } from "./decisions";
import { mailConfig, sendEmail } from "./mailer";
import { sendMessage, appendAudit, committed, defaultMandate, emptyAutopilot, negotiatedSavings, planSteps } from "./autopilot";
import { runPlanner } from "./agents/orchestrator";
import { answerQuestion } from "./answer";
import { getLLMConfig } from "./llm";
import { thisWeekText } from "./workflow";
import { stakeholderText } from "./stakeholders";

/**
 * Server-side Photon agent: polls the organizer's iMessages and acts on them even when no browser is open.
 * It owns the "active" plan (persisted to .data/), which the web app syncs with.
 */

type State = { rev: number; plan: EventPlan | null; thread: TextMessage[]; since: number; seen: string[] };
type Agent = { state: State; timer?: ReturnType<typeof setInterval>; polling: boolean; working: string | null; error?: string; notify?: ReturnType<typeof setTimeout> };

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
  return { rev: a.state.rev, plan: a.state.plan, thread: a.state.thread.slice(-80), working: a.working, error: a.error, linked: isLinked() };
}

/** Web app → server. Rejected (409) if the server changed since the client's last sync, so a text decision is never overwritten. */
export function pushPlan(plan: EventPlan, baseRev: number): boolean {
  if (baseRev !== agent().state.rev) return false;
  setPlan(plan);
  scheduleNotify();
  return true;
}

export function startPhotonAgent() {
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
  for (const step of planSteps(p, mandate)) ({ a, plan } = step.apply(a, plan));
  return { ...plan, autopilot: a };
}

function planSummary(p: EventPlan) {
  const b = p.brief;
  const v = p.venues[p.selectedVenue];
  const risk = p.risks.find((r) => r.level === "high") ?? p.risks[0];
  return `${b.title} is planned: ${v ? `${v.name}, ` : ""}${b.date} at ${b.startTime}, ${b.guests.toLocaleString()} guests, ${money(b.budget)} budget. Confidence ${p.score}/100${risk ? `; top risk: ${risk.issue}` : ""}.\nReply RUN and I'll negotiate with vendors and book it, or ask me anything.`;
}

function negotiationText(p: EventPlan, category?: string) {
  const a = p.autopilot!;
  const sls = (a.shortlists ?? []).filter((s) => !category || s.category.toLowerCase().startsWith(category));
  if (!sls.length) return category ? `No quotes for "${category}". Categories: ${(a.shortlists ?? []).map((s) => s.category).join(", ")}.` : "No vendor quotes yet.";
  if (category && sls.length === 1) {
    const q = sls[0].quotes[sls[0].pick];
    return `${sls[0].category} · ${q.vendor}\n${(q.rounds ?? []).map((r) => `${r.by === "agent" ? "Me" : "Them"}: ${r.note}`).join("\n") || "Not negotiated."}`;
  }
  const lines = sls.map((s) => {
    const q = s.quotes[s.pick];
    return q.listPrice && q.listPrice > q.price ? `${s.category}: ${q.vendor} ${money(q.listPrice)} → ${money(q.price)} (−${Math.round(((q.listPrice - q.price) / q.listPrice) * 100)}%)` : `${s.category}: ${q.vendor} ${money(q.price)}`;
  });
  return `Negotiated ${money(negotiatedSavings(a))} off in total.\n${lines.join("\n")}\nText NEGOTIATE ${sls[0].category.toUpperCase()} to see the back-and-forth.`;
}

const HELLO = `Hi, I'm EventPilot. Text PLAN and describe your event, e.g. "PLAN a 120-person founder mixer in SF next Friday, $15k". Then text RUN and I'll negotiate with vendors and book it, checking with you before big payments.`;

export async function handleInbound(text: string, id: string) {
  const a = agent();
  let n = 0;
  const reply = (s: string) => say(s, `in-${id}-${n++}`);
  const t = text.trim();
  const low = t.toLowerCase().replace(/[’']/g, "").replace(/[.!?]+$/, "");
  const history = a.state.thread.slice(-8, -1).map(({ dir, body }) => ({ dir, body }));

  const plan = t.match(/^(?:plan|new event|organi[sz]e)\b[\s:,-]+([\s\S]{6,})$/i);
  if (plan) {
    await reply(`On it. My crew is planning that now (${getLLMConfig() ? "2–3 minutes" : "a few seconds"}). I'll text you the plan.`);
    a.working = "Planning a new event";
    try {
      const p = await runPlanner({ prompt: plan[1].trim() }, () => {});
      setPlan(p);
      await reply(planSummary(p));
    } catch {
      await reply("Sorry, planning failed. Try again, or plan it in the app.");
    } finally {
      a.working = null;
    }
    return;
  }

  const p = a.state.plan;
  if (!p) return reply(HELLO);
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
    await reply(
      `Done. ${saved > 0 ? `Negotiated ${money(saved)} off vendor quotes. ` : ""}Paid ${auto.length} deposit${auto.length === 1 ? "" : "s"} (${money(auto.reduce((s, x) => s + x.amount, 0))}) on single-use cards; ${money(committed(ap.purchases))} committed of ${money(ap.mandate.totalCap)}.${pending.length ? ` ${pending.length} need${pending.length === 1 ? "s" : ""} your OK, details next.` : " Nothing needs you."}`,
    );
    await notifyDecisions();
    return;
  }

  if (/^(this week|week|workflow|todo|to do|whats due|timeline)$/.test(low)) return reply(thisWeekText(p));
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
    for (const m of drafts) {
      if (mail && m.channel === "email") {
        const r = await sendEmail(m, p.brief.title);
        if (!r.ok) { failed.push(`${m.to}: ${r.error}`); continue; }
        q = log(q, "agent", "email_delivered", `${m.subject} → ${r.to} (written for ${m.to})`);
      }
      q = sendMessage(q, m.id);
      sent.push(m);
    }
    setPlan(q);
    const shown = sent.slice(0, 4).map((m) => `${m.subject} → ${m.to}`).join("; ");
    const how = mail ? `emailed for real from ${mail.from}, all redirected to ${mail.redirect}` : "simulated";
    const head = sent.length ? `Sent ${sent.length} draft${sent.length > 1 ? "s" : ""} (${how}): ${shown}${sent.length > 4 ? ` and ${sent.length - 4} more` : ""}.` : "Nothing went out.";
    return reply(`${head}${failed.length ? ` ${failed.length} failed and stay in drafts (${failed[0]}).` : ""} Logged in the audit trail. Money still only moves on YES / PICK.`);
  }

  const neg = low.match(/^(?:negotiate|negotiation|savings|deals?)(?:\s+([a-z &]+))?$/);
  if (neg) return reply(p.autopilot ? negotiationText(p, neg[1]?.trim()) : "I haven't negotiated yet. Text RUN and I'll get quotes and haggle first.");

  if (!p.autopilot) {
    if (/^(status|help|\?|hi|hello|hey|start|whats next|what next)$/.test(low)) return reply(planSummary(p));
    if (/^(yes|no|y|n|approve|reject|all yes|pick|switch)\b/.test(low)) return reply("Autopilot hasn't run yet, so there's nothing to approve. Text RUN to start it.");
    const ans = await answerQuestion(t, planContext(p), history);
    return reply(ans ?? planSummary(p));
  }

  const r = applyReply(p, t, "iMessage");
  if (r.unknown) {
    a.working = "Thinking";
    const ans = await answerQuestion(t, planContext(p), history);
    a.working = null;
    const cur = agent().state.plan ?? p;
    setPlan(log(log(cur, "organizer", "text_question", `iMessage: "${t.slice(0, 80)}"`), "agent", "text_answer", ans ? `answered: "${ans.slice(0, 80)}"` : "no model; sent command help"));
    return reply(ans ?? r.reply);
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
