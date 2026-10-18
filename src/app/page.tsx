"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, Bot, History, RotateCcw, Send, Trash2 } from "lucide-react";
import { AgentRoster, AgentTrace } from "@/components/AgentTrace";
import { PlanView } from "@/components/PlanView";
import { PRESETS } from "@/components/presets";
import { usePlanner } from "@/lib/usePlanner";
import { deletePlan, loadPlans, savePlan } from "@/lib/storage";
import type { EventPlan } from "@/lib/types";

const KINDS = [
  { title: "Hackathons", sub: "Venues, permits, Wi-Fi and food for thousands, sized hour by hour.", img: "/images/event-hackathon.jpg", alt: "Rows of desks with monitors in a sunlit warehouse", match: /cal hacks/i },
  { title: "Mixers", sub: "Rooftops, bar tabs and guest lists that fit the budget.", img: "/images/event-mixer.jpg", alt: "Rooftop terrace with string lights over a city skyline", match: /mixer/i },
  { title: "Gatherings", sub: "Birthdays, picnics and dinners, planned in a minute.", img: "/images/event-gathering.jpg", alt: "Picnic blanket and bread board under oak trees", match: /picnic|birthday/i },
];

const REFINEMENTS = ["Make it 20% cheaper", "Move everything indoors", "Add 500 more hackers", "Start at 10am instead"];

export default function Home() {
  const { events, plan, setPlan, running, error, run } = usePlanner();
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState<EventPlan[]>([]);
  const started = running || events.length > 0 || plan;

  useEffect(() => setSaved(loadPlans()), []);
  useEffect(() => {
    if (plan) {
      savePlan(plan);
      setSaved(loadPlans());
    }
  }, [plan]);

  const submit = (p = prompt) => p.trim() && run({ prompt: p });
  const refine = (f = feedback) => {
    if (!plan || !f.trim()) return;
    run({ prompt: plan.brief.prompt, feedback: f, previous: plan });
    setFeedback("");
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-[18px]">
          <button onClick={() => window.location.reload()} className="font-display text-2xl leading-[30px] text-foreground">
            EventPilot
          </button>
          <span className="hidden text-[13px] text-subtle sm:block">Built for LA Hacks · AI Hackathon 2026</span>
        </div>
      </header>

      {!started ? (
        <>
          <section className="relative isolate overflow-hidden bg-accent px-6 pb-[72px] pt-[88px]">
            <Image src="/images/hero-pier.jpg" alt="" fill priority sizes="100vw" className="-z-20 object-cover" />
            <div className="absolute inset-0 -z-10 bg-accent/85" />
            <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
              <div className="mb-7 text-xs font-medium uppercase tracking-[0.1em] text-white/75">8 specialist agents · live tools · one prompt</div>
              <h1 className="font-display text-5xl leading-[1.04] tracking-[-0.015em] text-white sm:text-[68px]">
                Describe your event.
                <br />
                <span className="italic">Your AI crew runs it.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-[600px] text-base leading-[26px] text-white/80">
                A coordinator delegates to a venue scout, budget analyst, scheduler, logistics lead, comms writer and a critic — and you watch them work in real time.
              </p>

              <div className="mt-11 w-full rounded-2xl bg-background text-left shadow-[0_24px_48px_-24px_rgba(20,22,26,0.35)]">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
                  rows={4}
                  className="block w-full resize-none bg-transparent px-5 pb-4 pt-5 text-[15px] leading-6 text-foreground outline-none placeholder:text-subtle"
                  placeholder="e.g. A 36-hour hackathon in San Francisco for 2,000 students, $500k budget…"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 pl-4 pr-3">
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setPrompt(p.prompt)}
                        className={`rounded-lg border px-2.5 py-[5px] text-[13px] transition ${prompt === p.prompt ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:border-foreground/30 hover:text-foreground"}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <button className="btn-primary px-[18px] py-2.5" onClick={() => submit()} disabled={!prompt.trim()}>
                    Plan it <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mx-auto max-w-[1200px] px-6 pt-16">
            <h2 className="section-head">Plan anything</h2>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-5 sm:grid-cols-3">
              {KINDS.map((k) => {
                const preset = PRESETS.find((p) => k.match.test(p.label)) ?? PRESETS[0];
                return (
                  <button key={k.title} onClick={() => setPrompt(preset.prompt)} className="group flex flex-col text-left">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface">
                      <Image src={k.img} alt={k.alt} fill sizes="(min-width: 640px) 33vw, 100vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" />
                    </div>
                    <div className="mt-3 text-[15px] font-semibold text-foreground group-hover:text-accent">{k.title}</div>
                    <div className="text-[13px] leading-5 text-muted">{k.sub}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {saved.length > 0 && (
            <section className="mx-auto max-w-[808px] px-6 pb-24 pt-16">
              <h2 className="section-head"><History size={14} /> Your events</h2>
              <div>
                {saved.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
                    <button className="text-left" onClick={() => setPlan(p)}>
                      <div className="text-[15px] font-medium leading-[22px] text-foreground hover:text-accent">{p.brief.title}</div>
                      <div className="text-[13px] text-muted">{p.brief.date} · {p.brief.guests.toLocaleString()} guests · {p.brief.city}</div>
                    </button>
                    <button className="text-subtle hover:text-danger" onClick={() => { deletePlan(p.id); setSaved(loadPlans()); }} aria-label="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-12 px-6 pb-20 pt-10 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-6 lg:self-start">
            <div>
              <div className="section-head justify-between">
                <h2>Agent crew</h2>
                <button className="flex items-center gap-1 text-[13px] font-medium normal-case tracking-normal text-accent hover:underline" onClick={() => window.location.reload()}>
                  <RotateCcw size={12} /> New event
                </button>
              </div>
              <AgentRoster events={events} running={running} />
            </div>
            <div>
              <h2 className="section-head">Live reasoning trace</h2>
              <div className="pt-3.5">
                <AgentTrace events={events} running={running} />
              </div>
            </div>
            {plan && (
              <div className="flex flex-col gap-3 rounded-2xl bg-surface p-3.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">Refine with the crew</h2>
                <div className="flex flex-wrap gap-[5px]">
                  {REFINEMENTS.map((r) => (
                    <button key={r} disabled={running} onClick={() => refine(r)} className="rounded-lg border border-line bg-background px-2 py-1 text-xs text-muted hover:border-foreground/30 hover:text-foreground disabled:opacity-40">
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="input min-w-0" value={feedback} disabled={running} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refine()} placeholder="e.g. budget is $400k, add a hardware lab" />
                  <button className="btn-primary w-10 shrink-0 px-0" disabled={running || !feedback.trim()} onClick={() => refine()} aria-label="Send refinement">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}
          </aside>
          <div className="min-w-0">
            {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</div>}
            {plan ? (
              <div className={running ? "pointer-events-none opacity-50 transition" : "transition"}>
                <PlanView plan={plan} onChange={setPlan} />
              </div>
            ) : (
              <div className="grid min-h-[420px] place-items-center rounded-2xl border border-line p-10 text-center text-muted">
                <div>
                  <Bot size={28} className="mx-auto mb-3 animate-pulse text-accent" />
                  The crew is assembling your plan…
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
