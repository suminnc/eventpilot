"use client";
import { useEffect, useMemo, useRef } from "react";
import { Bot, CheckCircle2, Loader2, Wrench, Sparkles, AlertTriangle } from "lucide-react";
import { AGENTS, type AgentEvent, type AgentId } from "@/lib/types";

export function AgentRoster({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const status = useMemo(() => {
    const s: Partial<Record<AgentId, "working" | "done">> = {};
    for (const e of events) {
      if (e.type === "agent_start") s[e.agent] = "working";
      if (e.type === "agent_done") s[e.agent] = "done";
    }
    return s;
  }, [events]);
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(Object.keys(AGENTS) as AgentId[]).filter((id) => id !== "payments").map((id) => {
        const a = AGENTS[id];
        const st = status[id];
        return (
          <div key={id} title={`${a.name} — ${a.role}`} className="flex flex-col items-center gap-1 text-center">
            <div
              className={`relative grid grid-cols-[minmax(0,1fr)] h-9 w-9 place-items-center rounded-full border transition ${st === "working" ? "pulse-ring" : ""}`}
              style={{ borderColor: st ? a.color : "rgba(255,255,255,0.1)", color: a.color, background: st ? `${a.color}22` : "transparent", opacity: st || running ? 1 : 0.5 }}
            >
              {st === "done" ? <CheckCircle2 size={16} /> : st === "working" ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
            </div>
            <span className="text-[10px] leading-tight text-white/60">{a.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AgentTrace({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [events.length]);
  const visible = events.filter((e) => e.type !== "plan");
  return (
    <div className="scrollbar-thin flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1 text-sm">
      {visible.length === 0 && !running && <p className="text-white/40">Agent activity will stream here.</p>}
      {visible.map((e, i) => {
        if (e.type === "error")
          return (
            <div key={i} className="fade-up flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {e.message}
            </div>
          );
        const a = AGENTS[e.agent];
        const icon =
          e.type === "tool_call" || e.type === "tool_result" ? <Wrench size={12} /> : e.type === "agent_done" ? <CheckCircle2 size={12} /> : e.type === "thought" ? <Sparkles size={12} /> : <Bot size={12} />;
        const text =
          e.type === "tool_call" ? (
            <>
              calls <code className="rounded bg-white/10 px-1 font-mono text-[11px]">{e.tool}</code> <span className="font-mono text-[11px] text-white/40">{truncate(e.input, 120)}</span>
            </>
          ) : e.type === "tool_result" ? (
            <>
              <span className="text-white/40">↳ {e.tool}:</span> {truncate(e.output, 220)}
            </>
          ) : e.type === "agent_done" ? (
            <>
              {e.message} <span className="text-white/30">· {(e.ms / 1000).toFixed(1)}s</span>
            </>
          ) : (
            e.message
          );
        return (
          <div key={i} className={`fade-up flex gap-2 ${e.type === "tool_result" ? "pl-5" : ""}`}>
            <span className="mt-0.5 grid grid-cols-[minmax(0,1fr)] h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: `${a.color}22`, color: a.color }}>
              {icon}
            </span>
            <div className={`min-w-0 leading-snug [overflow-wrap:anywhere] ${e.type === "thought" ? "italic text-white/60" : "text-white/85"}`}>
              <span className="mr-1 font-medium" style={{ color: a.color }}>
                {a.name}
              </span>
              {text}
            </div>
          </div>
        );
      })}
      {running && (
        <div className="flex items-center gap-2 text-white/40">
          <Loader2 size={14} className="animate-spin" /> agents working…
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
