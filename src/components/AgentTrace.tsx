"use client";
import { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { AGENTS, OPTIONAL_AGENTS, SWARM_ROSTER, type AgentEvent, type AgentId } from "@/lib/types";

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
    <div>
      {SWARM_ROSTER.filter((id) => !OPTIONAL_AGENTS.includes(id) || status[id]).map((id) => {
        const a = AGENTS[id];
        const st = status[id];
        return (
          <div key={id} title={`${a.name} — ${a.role}`} className={`flex items-center gap-2.5 border-b border-line py-[9px] transition ${st || running ? "" : "opacity-50"}`}>
            <span className="w-[104px] shrink-0 text-sm font-medium text-foreground">{a.name}</span>
            <span className="flex-1 truncate text-[13px] text-muted">{a.role}</span>
            <span className="grid w-4 shrink-0 place-items-center">
              {st === "done" ? (
                <CheckCircle2 size={15} className="text-success" aria-label="Done" />
              ) : st === "working" ? (
                <Loader2 size={15} className="animate-spin text-accent" aria-label="Working" />
              ) : (
                <span className="h-[5px] w-[5px] bg-line" />
              )}
            </span>
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
    <div className="scrollbar-thin flex max-h-[60vh] flex-col gap-3.5 overflow-y-auto pr-1">
      {visible.length === 0 && !running && <p className="text-[13px] text-subtle">Agent activity will stream here.</p>}
      {visible.map((e, i) => {
        if (e.type === "error")
          return (
            <div key={i} className="fade-up flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-2.5 text-[13px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {e.message}
            </div>
          );
        const a = AGENTS[e.agent];
        if (e.type === "tool_result")
          return (
            <div key={i} className="fade-up min-w-0 pl-4">
              <div className="flex min-w-0 flex-col gap-px border-l-2 border-line pl-2.5">
                <span className="font-mono text-[11px] leading-4 text-subtle">↳ {e.tool}</span>
                <span className="text-[13px] leading-[19px] text-foreground [overflow-wrap:anywhere]">{truncate(e.output, 220)}</span>
              </div>
            </div>
          );
        return (
          <div key={i} className="fade-up flex gap-2.5">
            <span className={`mt-[7px] h-[5px] w-[5px] shrink-0 ${e.type === "agent_done" ? "bg-success" : "bg-subtle"}`} />
            <div className="flex min-w-0 flex-col gap-px">
              {e.type === "tool_call" ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold leading-[18px] text-foreground">{a.name}</span>
                    <span className="text-[13px] leading-[18px] text-muted">calls</span>
                    <code className="rounded-lg border border-line bg-surface px-1.5 font-mono text-[11px] leading-4 text-foreground">{e.tool}</code>
                  </div>
                  <span className="break-all font-mono text-[11px] leading-4 text-subtle">{truncate(e.input, 120)}</span>
                </>
              ) : (
                <>
                  <span className="text-[13px] font-semibold leading-[18px] text-foreground">{a.name}</span>
                  <span className={`text-[13px] leading-[19px] text-muted [overflow-wrap:anywhere] ${e.type === "thought" ? "italic" : ""}`}>
                    {e.message}
                    {e.type === "agent_done" && <span className="text-subtle"> · {(e.ms / 1000).toFixed(1)}s</span>}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
      {running && (
        <div className="flex items-center gap-2 text-[13px] text-subtle">
          <Loader2 size={14} className="animate-spin" /> agents working…
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
