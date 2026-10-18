# EventPilot: your AI event planning crew

Built for **LA Hacks: AI Hackathon 2026** ([tracks](https://live.lahacks.com/tracks)). The flagship demo plans **Cal Hacks 13.0**.

You describe an event in plain English. A **Coordinator** agent turns that into a structured brief and hands the work to seven specialist agents. You can watch each agent's reasoning and tool calls stream live:

| Agent | Job | Tools |
|---|---|---|
| Coordinator | Turns the request into a brief, routes the work, applies refinements | intent parser / LLM |
| Venue Scout | Finds and ranks venues by capacity, cost, and vibe | `venue_search` (curated LA + Bay Area catalog) |
| Budget Analyst | Splits the budget into line items and keeps a contingency | `budget_calculator` |
| Scheduler | Builds a run-of-show that can span several days | template + LLM |
| Logistics | Picks vendors, builds a timeline of tasks, checks weather, sizes ops (staff, food, Wi-Fi, power, sponsors) | `weather_forecast` (live [Open-Meteo](https://open-meteo.com), no key), `ops_calculator` |
| Comms | Writes the invite email and an SMS reminder | LLM |
| Permits | Lists likely permits for the city and venue, with agency, lead time, estimated fee and a file-by date | `permit_lookup` (SF, LA, Berkeley, Oakland rules) |
| Critic | Checks the plan for risks and scores confidence from 0 to 100 | rule checks + LLM |

Order of work: the Coordinator runs first. Scout and Weather run in parallel, then Budget and Scheduler, then Logistics and Comms, then Permits, and the Critic runs last. Every agent has an **LLM path** and a **deterministic offline path**, so the demo still works without a key or Wi-Fi to an LLM provider. Only the weather tool needs internet.

Other features:
- **Plan of action tab**: one checklist from today to event day. Milestones from the Cal Hacks operations playbook (scaled to the event, late ones compressed into a catch-up plan) each list the tasks due before them. Autopilot checks steps off as it works: venue hold, quotes requested, vendors chosen, deposits paid, permits filed, invites and attendee guide drafted. It also shows a readiness score, sizing (staff and safety, Wi-Fi/power/tables/restrooms, meal servings by diet, sponsor tiers, policies, day-of run sheet) and, collapsed, the team structure, handoff checks, guardrails, cadence and trackers.
- **Negotiator agent**: haggles with every vendor that can deliver in time, using competing quotes as leverage, before any deposit is paid.
- **Organizer texts (Photon 2.0)**: when Autopilot needs a decision (a deposit over your approval line), it texts the organizer over iMessage/SMS through [Photon](https://photon.codes/docs/beta). Reply `YES 1`, `NO 1`, `ALL YES`, `PICK CATERING 3` or `STATUS` and the agents act on it, log it, and text back. Ask anything else ("why Mission Street?", "how much budget is left?") and the model answers from the live plan; it can only answer, so money moves only on an explicit command. Without Photon keys the same thread runs simulated in the Autopilot tab.
- **Autopilot**: agents carry out the plan. They draft venue holds, vendor RFQs and the invite, and request deposits through a **Payments agent** that works under a spend mandate with step-up approval, single-use virtual cards (simulated), idempotency keys, and a hash-chained audit log.
- Refine a plan in follow-up chat, e.g. "make it 20% cheaper" or "add 500 more hackers".
- Pick an alternate venue, check off tasks, and copy the invite or SMS.
- Export the plan to **.ics** (the event plus prep-task deadlines) or **Markdown**.
- Plans are saved in localStorage.
- `POST /api/agent` returns JSON for other agents to call.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add an LLM key
npm run dev                  # http://localhost:3000
```

Any OpenAI-compatible endpoint works. The default is StepFun `step-5-preview`; Gemini and OpenAI settings are listed in `.env.example`.

### Photon (text the organizer)

1. In the [Photon beta dashboard](https://app.beta.photon.codes) create a project, assign a shared iMessage line to your phone number, and create an API key with `project:read` + `project:write`.
2. Set `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_AGENT_HANDLE` (the assigned line) and `PHOTON_ORGANIZER` (your number, E.164) in `.env.local`.
3. Text "hi" to the agent line once (shared lines can't start a conversation). EventPilot then texts every Autopilot decision and polls for your replies, so no public webhook is needed. It only ever messages `PHOTON_ORGANIZER`.

### API

```bash
curl -X POST localhost:3000/api/plan  -d '{"prompt":"Plan Cal Hacks 13.0 in SF, 36h, 2000 hackers, $500k"}'   # NDJSON stream of agent events
curl -X POST localhost:3000/api/agent -d '{"prompt":"..."}'                                                   # { plan, markdown }
```

### CREAO (independent Ops Team review)

The CREAO agent `6cb5afb7-e632-436d-b330-82772ec7a7ca` (agent.creao.ai) reviews every plan the Ops Team books. Set `CREAO_API_KEY` (capi_…, server only) and `CREAO_APP_ID`; EventPilot calls the API Trigger from the server, polls the async run (up to 10 min) and texts the verdict. Run share link: *(team: paste from the agent page)*. Agent instructions: [docs/creao-swarm-agent.md](docs/creao-swarm-agent.md).

## Prize tracks
Target tracks: Photon (messaging agent), CREAO (Best One-Person Company), Visa, Cognition/Devin, StepFun (every plan calls `step-5-preview`), Workday and Paper. The write-up for each is in [SUBMISSION.md](SUBMISSION.md). It also fits Applied Intelligence.

## Stack
Next.js 15 (App Router) · React 19 · Tailwind v4 · TypeScript · lucide-react. Venue rates are planning estimates, not quotes.

### Real vendor email

Set `SMTP_USER`, `SMTP_PASS` (a Gmail App Password) and `EMAIL_REDIRECT_TO` and EventPilot emails vendors for real. While testing, `EMAIL_REDIRECT_TO` sends every message to one inbox instead of the vendor. Once an email goes out, the agent:

- reads replies over IMAP (only from the vendor inbox), matched to each vendor by thread;
- uses the model to read the price, deposit terms, questions, accept/decline (with a rules-only fallback), while prices, caps and approvals stay fixed in code;
- counters with competing quotes (up to 3 rounds, never above a 10% ceiling over target, deposits capped at 50%), answers questions from the plan, and follows up when a vendor goes quiet;
- books inside the spend mandate, or texts you for YES before the deposit, then emails the vendor a confirmation (or a polite release if you say NO).

Text **VENDORS** to see every conversation. Payments remain simulated.

## Autonomous Ops Team v2.0.0

EventPilot runs as a bounded agent DAG modeled on how large hackathons are actually run:

`exec_scope` → Logistics lead scopes the event and assigns only the category agents that apply (**Food**, **Venue & Services**, **Program & Run-of-show**, **Merch & Gifts**, **People Logistics**, plus **Sponsorship** and **Comms** when relevant) → category agents work in parallel → **Finance gate** (budget line per category, 5% variance tolerance, contingency 10–15%, deposits ≤ 50%, card not wire) → lead reconciles, trade-offs become **Exec decision memos** → independent **Verifier** (owners, dates vs T-minus gates, no unsigned spend, ≥5 quotes for large services) → **Exec approval**.

Autonomy: when a plan is created (by text or in the app) and email is configured, the team runs Autopilot, emails every vendor and permit office, negotiates replies (2 rounds max, then Exec decides), follows up on silence, and switches to the runner-up when a vendor declines, holds above the ceiling, or goes quiet. The organizer is texted only for money approvals and decisions it can't make alone. Set `AUTONOMOUS=0` to turn this off. Text **TEAM** to see the agents, Finance verdicts, memos and verification.
