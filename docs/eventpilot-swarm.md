# EventPilot Subteam Swarm

The organizing crew restructured around the subteam roles. One **Exec** owns delivery and the attendee
experience; a **Logistics lead** decides what this event actually needs and distributes the work to one
**sub-agent per overarching task**; **Finance** gates every dollar; **Sponsorship** owns the revenue lever
and **Comms** owns the attendee voice; a **Verifier** checks the result adversarially before Exec approves.

Everything below is data, not prose: the roster, control loop, decision rights and guardrails live in
[`src/lib/swarm.ts`](../src/lib/swarm.ts) and drive the Workflow tab (`buildWorkflow` in
[`src/lib/workflow.ts`](../src/lib/workflow.ts)). Diagrams: [`eventpilot-swarm-architecture.html`](eventpilot-swarm-architecture.html).

## Roster

| Role | Count | Owns | Output |
|---|---|---|---|
| Exec | 1 | Delivery and the attendee experience; scope, priority, over-budget approval, day-of command | Attendee-experience rubric + weekly leads |
| Logistics Lead | 1 | Decides what the event needs, distributes the work, reconciles the final plan | Projects tracker (the hub) |
| ↳ Food | 1 | Catering, dietary needs, portions, delivery windows | Food row in the tracker |
| ↳ Venue & Services | 1 | Wifi, power, A/V, furniture, rigging, permits, COI, floorplan | Services rows + floorplan |
| ↳ Program & Run-of-show | 1 | Attendee-facing agenda and day-of timing | Run-of-show |
| ↳ Merch & Gifts | 1 | Swag, print, signage art, prizes, speaker gifts | Merch rows + design requests |
| ↳ People Logistics | 1 | Buses, hotels, parking, travel — only when needed | Transport plan |
| Finance | 1 | Budget, the cost gate, payments, sponsor invoicing, tax forms | Budget ledger + payment queue |
| Sponsorship | 1 | Revenue, sponsor relationships and deliverables | Deal sheet (shared with Finance) |
| Comms | 1 | The attendee guide and the reminder sequence | Attendee guide + promotions |

The roster collapses with event size: **intimate** → Host + Helper; **small** → Host, Logistics, Comms;
**medium/large** → the full swarm above. Sub-agents are only activated for categories this event needs —
the lead marks the rest `NOT NEEDED`.

## Control loop (the DAG)

```
exec_scope ─┬─> logistics_plan ──> categories (Food · Venue · Program · Merch · People, in parallel)
            ├─> revenue (Sponsorship)
            └─> comms
                                     │
                    categories + revenue ──> finance_gate ──> reconcile ──> verify ──> exec_approve
```

| # | Phase | Owner | Depends on | Does |
|---|---|---|---|---|
| 1 | Exec sets scope | Exec | — | Publishes the attendee-experience must-haves, the budget envelope and the guardrails |
| 2 | Logistics lead scopes the event | Logistics Lead | exec_scope | Decides which categories this event needs and writes the tracker skeleton |
| 3 | Sub-agents run in parallel | Food · Venue · Program · Merch · People | logistics_plan | Options, 3 quotes on one spec, a below-budget anchor, a nonprofit-discount ask |
| 4 | Sponsorship works the pipeline | Sponsorship | exec_scope | Deal sheet per prospect; a deal counts only once signed |
| 5 | Comms writes the attendee guide | Comms | exec_scope | Attendee guide + the T-10d / T-3d / day-of reminder sequence |
| 6 | Finance gates every dollar | Finance | categories, revenue | Budget-line cap, deposit ≤50%, payment method — approve, condition or veto |
| 7 | Logistics lead reconciles | Logistics Lead | finance_gate | One plan, one owner per row; deadlocks go to Exec as a decision memo |
| 8 | Verifier checks adversarially | Verifier | reconcile | Owners, dates against the T-minus gates, unsigned spend, unsourced numbers |
| 9 | Exec approves and publishes | Exec | verify | Resolves open decisions and publishes the this-week action list |

The loop is bounded and needs no human input mid-run. What actually makes the agents check each other is
the **binding Finance veto** (phase 6) and the **independent Verifier** (phase 8) — not the agents agreeing.

## Decision rights

| Who | Decides |
|---|---|
| Exec | Scope, priority, over-budget approval, day-of command |
| Logistics Lead | What the event needs and which vendor |
| Finance | Affordability — a binding veto on spend |
| Sub-agents | Options and trade-offs, never the final call |
| Verifier | Defects; Exec resolves what survives verification |

Quality-vs-cost disagreements survive at most **2 rounds**, then escalate to an Exec decision memo with
the cost delta and the experience impact.

## Guardrails

- A 10–15% contingency line sits in every budget
- Over budget, or a variance above 5%, needs Exec sign-off
- Deposits are capped at 50%; no spend without a signed quote or contract
- Vendor negotiation stops after 2 rounds, then Exec decides
- Money moves only through the purchase pipeline — never ad-hoc pings or shared vendor logins
- Pay by card or escrow, never a wire to a changed account; Wise/ACH for international
- Any new vendor, international order or deposit over $500 runs the vendor-vetting checklist
- Every shipment is logged with destination, receiver and arrive-by ≥3 days before load-in

## Who checks what

| Handoff | Checked by | Check |
|---|---|---|
| Sub-agent → Logistics Lead | Logistics Lead | Complete tracker row (owner, vendor, cost, order-by) and 3 quotes on one spec |
| Any spend → Finance | Finance | Budget line has room, deposit ≤50%, card over wire; approve, condition or veto |
| Over-budget item → Exec | Exec | Is the upgrade worth the experience it buys, and do the performance terms hold? |
| Sponsorship → Finance | Finance | Contract + invoice after negotiation; counts only once signed |
| Sponsorship → Logistics / Comms | Logistics Lead | Booth, power and map placement; promo obligations logged with dates |
| Venue & Services → Venue / fire marshal | Venue & Services | Floorplan approval, permits, fire-rated signage, delivery windows |
| Vendor proof → requester | Requester + Merch & Gifts | Proof checked (spelling, dates, colors, size) before paying |
| Reconciled plan → Verifier | Verifier | Owners, dates upstream of their gates, no unsigned spend or unsourced numbers |
| Verifier defects → Exec | Exec | Resolve or escalate every defect before publishing |

## What changed in the code

| Before | After |
|---|---|
| Agent ids `coordinator / scout / budget / scheduler / logistics / critic` | `exec / venue / finance / program / logistics_lead / verifier`, plus `food`, `merch`, `people`, `sponsorship` |
| `teamsFor()` hard-coded Design, Marketing, Tech and Hacker-experience teams | `swarmRoles()` in `swarm.ts`; Design folded into **Merch & Gifts**, Marketing into **Comms** |
| `checks` / `guardrails` written inline in `workflow.ts` | Derived from `swarmChecks()` / `GUARDRAILS` in `swarm.ts` |
| No visible control loop | `SWARM_PHASES` rendered as a **Control loop** section in the Workflow tab |
| Logistics lead built vendors inline | The lead **distributes to one sub-agent per category**, activated only when the category applies |

Gate ownership was remapped to the swarm roles (venue scouting and services → **Venue & Services**,
meals → **Food**, merch and brand → **Merch & Gifts**, applications/registration/guide → **Comms**,
walkthroughs and load-in → **Logistics Lead**, budget/orders/payments → **Finance**), with a fallback chain
so a small or intimate event still resolves every owner.

## Running it

The planner is unchanged in shape: give it a plain-English event and it emits the brief, venues, budget,
run-of-show, vendors, tasks, permits and the verifier review — now narrated by the swarm roles and gated by
Finance. The Workflow tab shows the roster, the control loop, the countdown, who-checks-what and the
guardrails for the event as scoped.
