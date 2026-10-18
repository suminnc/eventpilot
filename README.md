# EventPilot: your AI event planning crew

Built for **LA Hacks: AI Hackathon 2026** ([tracks](https://live.lahacks.com/tracks)). The flagship demo plans **Cal Hacks 13.0**.

You describe an event in plain English. A **Coordinator** agent turns that into a structured brief and hands the work to six specialist agents. You can watch each agent's reasoning and tool calls stream live:

| Agent | Job | Tools |
|---|---|---|
| Coordinator | Turns the request into a brief, routes the work, applies refinements | intent parser / LLM |
| Venue Scout | Finds and ranks venues by capacity, cost, and vibe | `venue_search` (curated LA + Bay Area catalog) |
| Budget Analyst | Splits the budget into line items and keeps a contingency | `budget_calculator` |
| Scheduler | Builds a run-of-show that can span several days | template + LLM |
| Logistics | Picks vendors, builds a timeline of tasks, checks weather | `weather_forecast` (live [Open-Meteo](https://open-meteo.com), no key) |
| Comms | Writes the invite email and an SMS reminder | LLM |
| Critic | Checks the plan for risks and scores confidence from 0 to 100 | rule checks + LLM |

Order of work: the Coordinator runs first. Scout and Weather run in parallel, then Budget and Scheduler, then Logistics and Comms, and the Critic runs last. Every agent has an **LLM path** and a **deterministic offline path**, so the demo still works without a key or Wi-Fi to an LLM provider. Only the weather tool needs internet.

Other features:
- **Autopilot**: agents carry out the plan. They draft venue holds, vendor RFQs and the invite, and request deposits through a **Payments agent** that works under a spend mandate with step-up approval, single-use virtual cards (simulated), idempotency keys, and a hash-chained audit log.
- Refine a plan in follow-up chat, e.g. "make it 20% cheaper" or "add 500 more hackers".
- Pick an alternate venue, check off tasks, and copy the invite or SMS.
- Export the plan to **.ics** (the event plus prep-task deadlines) or **Markdown**.
- Plans are saved in localStorage.
- `POST /api/agent` returns JSON for other agents to call. `agents/fetch/` holds a **Fetch.ai uAgent** that registers EventPilot on Agentverse so it can be found through ASI:One.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add an LLM key
npm run dev                  # http://localhost:3000
```

Any OpenAI-compatible endpoint works. The default is StepFun `step-5-preview`; Gemini and OpenAI settings are listed in `.env.example`.

### API

```bash
curl -X POST localhost:3000/api/plan  -d '{"prompt":"Plan Cal Hacks 13.0 in SF, 36h, 2000 hackers, $500k"}'   # NDJSON stream of agent events
curl -X POST localhost:3000/api/agent -d '{"prompt":"..."}'                                                   # { plan, markdown }
```

### Fetch.ai / ASI:One

```bash
cd agents/fetch && pip install -r requirements.txt
EVENTPILOT_URL=https://<deploy>/api/agent AGENT_SEED="<secret>" python eventpilot_agent.py
```

## Prize tracks
Target tracks: Creao, Visa, Workday, Paper, and Cognition/Devin. The write-up for each is in [SUBMISSION.md](SUBMISSION.md). It also fits Applied Intelligence, the Fetch.ai ASI:One challenge, and StepFun.

## Stack
Next.js 15 (App Router) · React 19 · Tailwind v4 · TypeScript · lucide-react. Venue rates are planning estimates, not quotes.
