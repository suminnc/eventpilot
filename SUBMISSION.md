# EventPilot: LA Hacks AI Hackathon 2026 submission notes

**One line:** you describe an event in one prompt. A crew of AI agents plans it, then the agents **carry the plan out**: they draft vendor outreach and make guarded purchases under a spend mandate you control. The flagship demo is **Cal Hacks 13.0**: 2,000 hackers, 36 hours, San Francisco.

## How it works
1. **Plan.** A Coordinator hands work to Venue Scout, Budget Analyst, Scheduler, Logistics, Comms and Critic. Their reasoning and tool calls (`venue_search`, `budget_calculator`, live `weather_forecast`) stream into the UI. The reasoning model is StepFun `step-5-preview`, run with `reasoning_effort: low` to keep cost and latency down.
2. **Refine.** Follow-up chat ("make it 20% cheaper", "add 500 more hackers") re-runs the crew with the change.
3. **Autopilot.** One click runs the plan. Agents draft venue hold requests and vendor RFQs, request deposits, and complete the matching tasks. You approve anything over your threshold.

---

## Creao: Best AI-First Disruptor / One-Person Company / Team Empowerment
Running an event like Cal Hacks usually takes a team of 30+ organizers months of spreadsheets, vendor email threads and approval chains. EventPilot is AI-first from the start: the agent does the whole job, not just the chat. It reads the brief, scouts venues, balances a $500k budget, builds a 36-hour run-of-show, then **executes**. It sends the outreach, requests deposits and checks off the timeline. The human role shrinks to approving decisions. With it, one person can run an event that used to need an ops team, and a small team can run a much larger one.

## Visa: The Future of Shopping, Powered by AI, Secured by Visa
EventPilot's **Payments agent** shows agentic purchasing with security built in, not added afterward:
- **Spend mandate.** The organizer sets a total cap, a per-purchase cap and a category allowlist. The agent cannot go outside it, and blocked attempts are logged.
- **Step-up approval.** Any purchase over the threshold sits in an approval queue until a human approves it.
- **Single-use virtual cards.** Each approved purchase gets its own masked card, so if a merchant leaks the number, the damage stops at that one transaction.
- **Idempotency keys.** If the agent retries, it can't pay twice.
- **Tamper-evident audit log.** Every agent and human action is hash-chained, and the UI checks the chain.

*Payments are simulated in this prototype; no real card-network calls are made. The next step would be to replace `virtualCard()` and `evaluate()` in `src/lib/autopilot.ts` with Visa Intelligent Commerce / tokenization APIs.*

## Workday: Build the Future of Work with AI
New event and operations staff spend their first weeks learning unwritten rules: which venues hold 2,000 people, how to split a budget, when to send the reminder email, who approves a $40k deposit. EventPilot puts that know-how into a crew of AI teammates. A new ops hire describes the goal and gets a complete, explained plan, with a timeline of owned tasks, a risk review from the Critic agent, and approval guardrails that teach company spend policy as they work. They contribute from day one, and the experienced staff stop being a bottleneck.

## Paper: Best Designed Hack
Dark, focused UI with a live agent roster and a streaming reasoning trace, so you can watch the crew think. The plan has tabbed views (overview, multi-day schedule, budget bar, venue picker, task checklist, invite preview), and the Autopilot console makes approvals and the audit log easy to scan. *(Ask Paper's booth whether the designs need to be made in Paper's tool.)*

## Cognition: Best Use of Devin
Devin built EventPilot end to end in one session: it read the LA Hacks tracks page, designed the multi-agent architecture, wrote the Next.js app, ran headless browser tests, tuned StepFun cost (reasoning effort and token caps), and shipped every commit to this repo. Devin session: https://app.devin.ai/sessions/deef918ebc6947028bd720579df7586f
