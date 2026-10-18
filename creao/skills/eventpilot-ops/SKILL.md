---
name: eventpilot-ops
description: Plan, verify and operationalize events with EventPilot's Autonomous Ops Team. Use when asked to plan an event (hackathon, conference, mixer, wedding), review an EventPilot plan, build its budget sheet or milestone calendar, or prepare vendor outreach.
---

# EventPilot Ops

EventPilot (https://eventpilot-sigma.vercel.app) is an autonomous event-ops team: Exec → Logistics lead → category agents (Venue & Services, Food, Program, Merch & Gifts, People, Sponsorship, Comms) → Finance gate → Verifier → Exec approval. This skill lets CREAO run that team, check its output, and push the results into the organizer's tools.

## 1. Plan the event (call EventPilot)

```bash
curl -s -X POST https://eventpilot-sigma.vercel.app/api/agent \
  -H 'content-type: application/json' \
  -d '{"prompt":"<the organizer brief, e.g. Cal Hacks 13.0, Palace of Fine Arts SF, Oct 23-25 2026, 36h, 2000 hackers, $500k>"}' > plan.json
```

The response is `{ plan, markdown }`. `plan` has `brief`, `venues` (+`selectedVenue`), `budget` (category/amount/note), `schedule`, `tasks` (title/owner/due), `vendors`, `permits` (agency/fee/fileBy), `ops` (staffing, safety, infrastructure, catering, sponsorship), `risks` and `summary`. A full plan can take 2–4 minutes; allow up to 300 s.

## 2. Verify it (be the independent Verifier)

Check and report PASS/FAIL with numbers for each:
- Budget lines sum to the brief budget; contingency is 10–15%.
- Every permit fee is inside a budget line; no permit is due after the event.
- Every task has an owner and a due date before the event; no orphan budget line (each has an owner/vendor).
- Large services (venue, catering, AV/Wi-Fi, security): the plan names one recommended vendor per category; EventPilot's Autopilot compares 5–6 quotes per category and pays deposits of 25–30% (venue 30%, others 25%) at booking time. FAIL only if `plan.venues` has fewer than 3 options or a stated deposit exceeds 50%.
- Catering covers every dietary need in the brief; Wi-Fi spec states bandwidth and access-point count for the headcount.
- Staffing: security and EMT counts suit headcount and duration; overnight events have shift coverage.
Finish with a verdict: APPROVE, APPROVE WITH FIXES (list them), or BLOCK.

## 3. Operationalize it (connectors, if connected)

- **Google Sheets:** create "<event title> – Master budget" with columns Category, Item, Vendor, Allocated, Committed, Spent, Remaining, Notes from `plan.budget`; add a Permits tab (Permit, Agency, Fee, File by) and a Tasks tab (Task, Owner, Due, Status).
- **Google Calendar:** one all-day event per milestone in `plan.tasks` (title = task, description = owner), plus the event itself from `plan.schedule`.
- **Gmail:** create **drafts only** of the vendor RFQ emails (one per vendor category, include the headcount, date, dietary split and Wi-Fi spec). Never send to real vendors or attendees.

## Guardrails
- Never move money, sign contracts or contact vendors directly; EventPilot asks the organizer by text for anything that spends money.
- Quote dollar figures only from `plan.json`.
- Link the plan's markdown and any sheet/calendar you created in your final answer.
