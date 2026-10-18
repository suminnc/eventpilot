# 2½-minute demo script

Use StepFun for live reasoning (2–3 min per plan; start it before recording) or leave `LLM_API_KEY` empty for the instant offline planner. Have the organizer's phone on screen (mirroring) for the texts.

| Time | Show | Say |
|---|---|---|
| 0:00 | Home screen | "Cal Hacks takes 30 organizers months to run. EventPilot takes one sentence, then runs the event for you." |
| 0:10 | **Cal Hacks 13.0** preset → **Plan it**; reasoning trace streams | "An Autonomous Ops Team splits the work: Exec scopes, the Logistics lead assigns Food, Venue, Program, Merch, Sponsorship and Comms agents, Finance can veto, and a Verifier checks everything before Exec signs off." |
| 0:30 | **Overview** → **Venues** → **Budget** | "Palace of Fine Arts for 2,000 hackers, a $500k budget that reconciles to the dollar with 10% contingency, and permits with agencies, fees and file-by dates." |
| 0:45 | **Plan of action** → **Run Autopilot** | "One checklist from today to event day. Autopilot emails every vendor and permit office for real, collects 5+ comparable quotes, negotiates, pays small deposits on single-use cards, builds the master budget and day-of ops, and checks each step off as it goes." |
| 1:05 | Phone: deposit text → reply `YES 1`; ask "why this caterer?" | "Money outside the mandate comes to my phone over Photon. I reply YES and it pays, logs it and texts back. I can just ask it questions; it answers from the live plan." |
| 1:20 | Inbox: reply to a vendor email as the vendor ("best I can do is $X") → phone gets update | "Vendors reply by email. The agent negotiates two rounds, and if a vendor goes quiet or says no, Exec switches to the runner-up on its own." |
| 1:35 | **Team** tab → CREAO verdict | "A CREAO agent independently reviews every booked plan. Its findings, like $4,800 of unbudgeted permit fees, are now enforced in code." |
| 1:50 | **Day-of ops**: shift lunch +15, report a critical medical incident | "Event day: live run of show. Delay lunch and the announcements move and the caterer is flagged. A critical incident is routed to the safety lead and escalated. Or by text: `DELAY LUNCH 15`, `INCIDENT medical fainted near stage`." |
| 2:10 | **Budget** → Finance: submit a reimbursement, receipt check fails, budget request suggestion | "Finance runs like a real org: receipt checks, finance then director approval, budget requests with a suggested approve, partial or deny, and role-based access." |
| 2:25 | Audit log / readiness % | "One organizer, one prompt, a fully run event, with every action in a tamper-evident audit log." |

## Devpost copy

**Tagline:** One sentence in, a fully run event out: an autonomous AI ops team that plans, books, negotiates, pays and runs your event, and texts you only when money moves.

**Inspiration:** Cal Hacks 13.0 is 2,000 hackers for 36 hours on a $500k budget, run by 30+ student organizers juggling spreadsheets, vendor emails, permits and day-of chaos. We wanted one organizer to run it with an AI team.

**What it does:**
- Turns a one-line brief into a full plan: venue, budget, run of show, staffing and safety, Wi-Fi/power/meal sizing, sponsor tiers and permits.
- Autopilot carries it out. It emails vendors and permit offices, collects 5+ comparable quotes, negotiates by email, switches vendors that decline or go quiet, and pays deposits under a spend mandate.
- Texts the organizer over iMessage (Photon) for approvals; YES/NO replies move the money.
- On event day it runs a live run-of-show with delay shifting, incident routing, meal and shipment tracking, sponsor deliverables, prize fulfillment and a post-mortem.
- A Finance workspace handles reimbursements, budget requests and roles.

**How we built it:**
- Next.js + TypeScript, with StepFun `step-5-preview` for every agent and deterministic fallbacks.
- Photon 2.0 for iMessage; Gmail SMTP/IMAP for real vendor email, all redirected to a test inbox.
- A CREAO agent for independent review; Open-Meteo for weather.
- Day-of ops and finance were ported in from two of our Cal Hacks tools, Gatherly (ops console) and The Fub (finance), as typed modules over the same event plan.
- Payments are simulated, under a hash-chained audit log.

**Challenges:** making the agents safe enough to act on their own. Finance veto, >5% variance sign-off, 50% deposit cap, sanity checks on counter-offers, and texts that never quote a price the plan doesn't contain.

**What's next:** Visa Intelligent Commerce for real tokenized payments, and running it live for Cal Hacks 13.0 on Oct 23.
