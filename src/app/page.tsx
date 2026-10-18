"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Bot, History, RotateCcw, Send, Sparkles, Trash2, Wand2 } from "lucide-react";
import { AgentRoster, AgentTrace } from "@/components/AgentTrace";
import { PlanView } from "@/components/PlanView";
import { PRESETS } from "@/components/presets";
import { usePlanner } from "@/lib/usePlanner";
import { deletePlan, loadPlans, savePlan } from "@/lib/storage";
import type { EventPlan } from "@/lib/types";

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
    <main className="bg-grid min-h-screen">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <button onClick={() => window.location.reload()} className="flex items-center gap-2">
          <span className="grid grid-cols-[minmax(0,1fr)] h-8 w-8 place-items-center rounded-lg bg-accent text-[#1a0d07]"><Wand2 size={16} /></span>
          <span className="font-display text-2xl">EventPilot</span>
        </button>
        <span className="hidden text-xs text-white/40 sm:block">Built for LA Hacks · AI Hackathon 2026</span>
      </header>

      {!started ? (
        <section className="mx-auto max-w-3xl px-6 pb-20 pt-10 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
            <Sparkles size={12} className="text-accent" /> 8 specialist agents · live tools · one prompt
          </div>
          <h1 className="font-display text-5xl leading-[1.05] sm:text-7xl">
            Describe your event.
            <br />
            <span className="italic text-accent">Your AI crew runs it.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60">
            A coordinator delegates to a venue scout, budget analyst, scheduler, logistics lead, comms writer and a critic — and you watch them work in real time.
          </p>

          <div className="card mt-8 p-3 text-left">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
              rows={4}
              className="w-full resize-none bg-transparent p-2 text-[15px] outline-none placeholder:text-white/30"
              placeholder="e.g. A 36-hour hackathon in San Francisco for 2,000 students, $500k budget…"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => setPrompt(p.prompt)} className={`rounded-full border px-3 py-1 text-xs transition ${prompt === p.prompt ? "border-accent/60 bg-accent/10 text-white" : "border-white/10 text-white/60 hover:text-white"}`}>
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>
              <button className="btn-primary" onClick={() => submit()} disabled={!prompt.trim()}>
                Plan it <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {saved.length > 0 && (
            <div className="mt-10 text-left">
              <h2 className="mb-3 flex items-center gap-2 text-sm text-white/50"><History size={14} /> Your events</h2>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {saved.map((p) => (
                  <div key={p.id} className="card flex items-center justify-between p-3">
                    <button className="text-left" onClick={() => setPlan(p)}>
                      <div className="font-medium">{p.brief.title}</div>
                      <div className="text-xs text-white/40">{p.brief.date} · {p.brief.guests.toLocaleString()} guests · {p.brief.city}</div>
                    </button>
                    <button className="text-white/30 hover:text-red-300" onClick={() => { deletePlan(p.id); setSaved(loadPlans()); }} aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="mx-auto grid max-w-7xl gap-5 px-6 pb-16 grid-cols-[minmax(0,1fr)] lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium"><Bot size={15} /> Agent crew</h2>
                <button className="flex items-center gap-1 text-xs text-white/40 hover:text-white" onClick={() => window.location.reload()}>
                  <RotateCcw size={12} /> New event
                </button>
              </div>
              <AgentRoster events={events} running={running} />
            </div>
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-medium">Live reasoning trace</h2>
              <AgentTrace events={events} running={running} />
            </div>
            {plan && (
              <div className="card p-4">
                <h2 className="mb-2 text-sm font-medium">Refine with the crew</h2>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {REFINEMENTS.map((r) => (
                    <button key={r} disabled={running} onClick={() => refine(r)} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:text-white disabled:opacity-40">
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="input" value={feedback} disabled={running} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refine()} placeholder="e.g. budget is $400k, add a hardware lab" />
                  <button className="btn-primary px-3" disabled={running || !feedback.trim()} onClick={() => refine()} aria-label="Send refinement">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}
          </aside>
          <div>
            {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
            {plan ? (
              <div className={running ? "pointer-events-none opacity-50 transition" : "transition"}>
                <PlanView plan={plan} onChange={setPlan} />
              </div>
            ) : (
              <div className="card grid grid-cols-[minmax(0,1fr)] min-h-[420px] place-items-center p-10 text-center text-white/40">
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
