# EventPilot: LA Hacks AI Hackathon 2026 submission notes

**Live app:** https://eventpilot-sigma.vercel.app/  
**Code:** https://github.com/suminnc/eventpilot

**One line:** describe an event in one prompt. A crew of AI agents plans it, then **runs it**: they compare vendors, file permits, book vendors, and pay deposits under a spend mandate you control, writing every step to a tamper-evident audit log. Flagship demo: **Cal Hacks 13.0**, 2,000 hackers, 36 hours, San Francisco.

## How it works
1. **Plan.** A Coordinator hands work to Venue Scout, Budget Analyst, Scheduler, Logistics, Comms, Permits and a Critic. **Logistics** also sizes the operation: volunteer shifts, security and EMTs, Wi-Fi/power/tables/restrooms, meal servings split by diet, check-in lanes, sponsor tiers and a day-of run sheet, rolled up into a readiness score. The **Permits** agent builds a jurisdiction-aware checklist (fire/assembly, overnight occupancy, amplified sound, Port of SF, food, insurance, police/traffic) with agencies, lead times and estimated fees, and flags any permit that can't clear before the event. Their reasoning and tool calls (`venue_search`, `budget_calculator`, live `weather_forecast`) stream into the UI. The model is StepFun `step-5-preview` with `reasoning_effort: low`. Every agent has a deterministic fallback, so a failed model call never breaks the plan.
2. **Refine.** Chat follow-ups like "make it 20% cheaper" or "add 500 more hackers" re-run the crew.
3. **Autopilot.** One click and the **Shopper** collects 6 quotes per vendor category, scores them against the brief and explains its pick. The **Negotiator** then haggles with every vendor that can deliver in time, citing the cheapest competing quote, and re-picks on the negotiated prices, so it never trades away diets or lead time for price. **Logistics** drafts the booking emails. **Permits** drafts each application (marked *expedited* when inside the agency's lead time). **Payments** pays deposits (vendors, security, EMTs) and permit fees inside the mandate, and **Comms** drafts sponsor outreach per tier. You approve anything big, override any pick, send messages, and refund from the receipt.
4. **Run the day and the money.** Autopilot also builds the **day-of ops** console (live run of show, delay shifting, incident routing and escalation, meals vs. check-ins, shipments, sponsor deliverables, prize fulfillment, post-mortem; ported from our Gatherly ops tool) and the **Finance** workspace (master budget, reimbursements with receipt checks and two-step approval, budget requests with suggested approve/partial/deny, roles; ported from The Fub). Both live on the same event plan and tick off the Plan of action's event-day, retro and payment-closeout gates.
5. **Decide by text.** Anything over the approval line is texted to the organizer through **Photon 2.0** (iMessage/SMS). Replies like `YES 1`, `ALL YES`, `PICK CATERING 3` or `STATUS` are parsed, applied under the same mandate, written to the audit log, and confirmed by text. Free-form questions ("why Mission Street?", "what permits are late?") are answered by the model from the live plan, read-only.

> Demo data: venue rates, vendor quotes and permit fees and lead times are estimates. The permit checklist is a planning aid, not legal advice. Payments are **simulated** (no real card-network calls). Emails are real but every one is redirected to a single test inbox, so no real vendor or guest is contacted; the inbox is read over IMAP and replies written there are negotiated by the agents. Texts go only to the one configured organizer number over Photon.

---

## StepFun: Get It Done with Step 5 Preview
Every plan calls `step-5-preview` (`reasoning_effort: low`, 8k output cap, one retry) for the Coordinator and each specialist agent: parsing the brief, venue scouting, budget split, run-of-show, logistics sizing, permits and the Critic. It also answers the organizer's free-form texts from the live plan, read-only.
- **Alongside it:** Photon 2.0 carries the texts, Gmail SMTP/IMAP carries vendor email (redirected to one test inbox), the CREAO agent gives an independent second review, and Open-Meteo supplies the forecast. Budget math, payments and guardrails are deterministic code, so the model can't move money.
- **Reliability and control:** every agent has a deterministic fallback, the trace shows which steps fell back, and the organizer approves anything over the spend line by text or button.

## Visa: The Future of Shopping, Powered by AI, Secured by Visa
**Pitch:** EventPilot turns B2B event procurement, today a month of emails, spreadsheets and corporate-card requests, into one conversation with an agent that shops for you and pays safely.

| Shopping stage | What EventPilot does |
|---|---|
| Discovery | The Shopper collects 6 quotes per category (catering, AV, photography, rentals) |
| Decision-making | Scores price vs. target, rating, lead time and cancellation terms. Rules out vendors that can't deliver before the event date |
| Negotiation | The Negotiator runs counteroffer rounds with each viable vendor, using competing quotes as leverage. Every round is shown on the quote card and the savings are logged (vendors are simulated, each with a hidden floor price) |
| Personalization | Matches vendors to the brief, e.g. it picks a caterer covering *halal, vegan, gluten-free* because Cal Hacks asked for them |
| Checkout | One click. The agent books and pays every deposit inside the mandate |
| Payments | Spend mandate (total cap, per-purchase cap, category allowlist) plus approval above a threshold. A single-use virtual card for each payment. Idempotency keys stop double charges |
| Post-purchase | Receipts, refund-to-card, and "choose this instead" overrides that cancel or refund the old deposit and re-check the new one against the mandate |

**Trust & Responsibility (15%):** every recommendation shows *why* it was picked and what it traded off. People make the big decisions (approval queue, overrides). Blocked categories and caps are enforced in code, not in the prompt. Every agent and human action goes into a hash-chained audit log that the UI checks. Only the minimum data is used: the event brief, no personal data.
**Commerce Impact (15%):** merchants get structured bookings that convert, with a deposit attached. Organizers spend minutes, not weeks. Single-use cards reduce fraud and chargebacks.
**Next step:** replace `virtualCard()` and `evaluate()` in `src/lib/autopilot.ts` with Visa Intelligent Commerce, tokenized credentials and Visa's spend controls.

## CREAO: Best One-Person Company
**One human operating like a funded event-ops team.** EventPilot's Autonomous Ops Team is an org chart of agents that hand work to each other: Exec scopes → Logistics lead assigns category agents (Food, Venue & Services, Program, Merch & Gifts, People Logistics, Sponsorship, Comms) → Finance gate (affordability veto, >5% variance needs Exec, 10% contingency, 50% deposit cap) → Logistics reconciles → Verifier → Exec approves. One organizer replaces the 30+ person team that runs Cal Hacks.
- **CREAO agent:** ID `6cb5afb7-e632-436d-b330-82772ec7a7ca` on agent.creao.ai. Run share link: [https://agent.creao.ai/share/63d7a2f6f2e7360d5c8e5e3fb765fe19](https://agent.creao.ai/share/63d7a2f6f2e7360d5c8e5e3fb765fe19) (eventpilot-ops skill: plans Cal Hacks 13.0 through EventPilot, verifies it, builds the master budget sheet).
- **What it does:** after the native Ops Team books a plan, EventPilot calls the CREAO agent through the API Trigger from the server (`src/lib/creao.ts`, key never in the browser), polls the async run, and texts the verdict to the organizer. Text `CREAO` to run it on demand. Its findings changed the product: it caught $4,800 of unbudgeted permit fees, a double-counted venue cost, contingency below 10% and a Wi-Fi spec with no bandwidth, all now enforced in code.
- **Demo:** the Team tab shows the org chart, handoffs and CREAO's verdict; the organizer's phone shows the CREAO text.

## Workday: Build the Future of Work with AI
- **Problem:** a new event or ops coordinator joins a student org or company and is handed a 2,000-person event. All the know-how is unwritten: which venues fit, how to split a budget, when deposits are due, who approves what.
- **User:** early-career operations, events and program staff in their first months.
- **How the agent works:** a Coordinator delegates to seven specialist agents that plan, critique and then carry out the work (Autopilot). Every step is visible in a live reasoning trace.
- **Autonomous:** venue search, budget, schedule, vendor comparison, outreach drafts, deposits under the mandate.
- **Human in the loop:** the new hire sets the mandate, approves spend over the threshold, overrides vendor picks, and approves each message before it's sent.
- **Data and assumptions:** only synthetic venue and vendor data plus the event brief. No employee or personal data.
- **Responsible AI:** *Transparent* (every pick explains its reasoning and trade-offs), *Accountable* (approval queue and overrides), *Reliable* (deterministic fallbacks, exact budget math, a Critic agent that flags risks and gives a confidence score), *Privacy-preserving* (no personal data), *Fair* (vendors are scored on stated criteria, shown side by side).
- **Org impact:** new hires can contribute from day one, senior staff stop being the bottleneck, and the mandate teaches company spend policy as they work.

## Photon: Build a Messaging Agent
EventPilot's agents live in the organizer's iMessage. They don't ping for everything: low-risk deposits go through on their own inside the spend mandate, and the agent texts only when a human call is needed (a deposit over the approval line, a vendor switch that needs a new deposit).
- **Human in the loop:** the reply is the decision. `YES 1` issues a single-use card, `NO 1` releases it, `PICK CATERING 3` switches vendors, which refunds the old deposit and re-checks the new one against the mandate.
- **Context that persists:** the thread is stored with the plan, so numbering stays stable across refinements and re-runs, and `STATUS` summarizes spend, open decisions and vendor picks at any time.
- **Safety and fallbacks:** it only ever texts the one configured organizer. Replies are idempotent (Photon message IDs are deduped and every send uses an idempotency key). Ambiguous replies ("yes" with two open items) get a clarifying question. Already-decided items aren't re-applied. Every text decision is in the hash-chained audit log, and if Photon is down the in-app buttons still work.
- **Answers, not just commands:** anything that isn't a command goes to the model with a compact snapshot of the plan and the last few texts, so "why this caterer?" or "how much is left?" gets a grounded answer. The model can't act: it points to the exact command (e.g. `YES 2`) instead, and both the question and the answer are logged. Without a model it falls back to the command help.
- **Always on:** the agent runs on the server (`src/lib/photonAgent.ts`), so it answers with no browser open, and the web app syncs to whatever you do by text. `PLAN <brief>` plans a new event, `RUN` runs Autopilot, `NEGOTIATE` shows the haggling, `SEND` sends every drafted vendor email and permit filing, `THIS WEEK` lists the Plan of action milestones due, `TEAM` shows who decides what, `CREAO` asks for an independent review, and `STAKEHOLDERS` gives the organizer/sponsor/vendor/attendee review, and `ATTENTION`, `INCIDENT …`, `DELAY LUNCH 15` and `FINANCE` run event day from the phone.
- **It also emails:** vendors and permit offices get real emails (redirected to one test inbox), replies are read over IMAP, negotiated for up to 2 rounds, and quiet or declining vendors are swapped for the runner-up. The organizer is texted only for money and venue decisions.
- **Built on Photon 2.0:** `@photon-ai/api` `listMessages`/`sendMessage` on a shared iMessage line (`src/lib/photon.ts`, `src/app/api/photon/route.ts`).

## Paper: Best Designed Hack
Designed in Paper (desktop app + MCP) and sent back to code. A warm light canvas with one sage accent (`#4f6146`), Instrument Serif display type with Geist for UI and Geist Mono for every number. One primary action per screen. Small-caps section heads over a strong rule. The Plan of action is one checklist that Autopilot ticks off live, and vendor comparison shows one category at a time behind an animated segmented control. Checked at 1440px and 390px with no horizontal overflow. *(team: add the Paper file link and 2–3 screenshots)*

## Cognition: Best Use of Devin
Judged on creativity, novelty and polish. Devin built EventPilot end to end in one session: it read the LA Hacks tracks page, designed the multi-agent architecture, wrote the Next.js app, ran headless-browser end-to-end tests, tuned StepFun cost (reasoning effort, token caps, deterministic budget math) and pushed every commit to this repo. The team set direction (Cal Hacks use case, prize strategy, $25 model budget) and Devin did the planning, coding, testing and shipping.
Devin session: https://app.devin.ai/sessions/deef918ebc6947028bd720579df7586f
