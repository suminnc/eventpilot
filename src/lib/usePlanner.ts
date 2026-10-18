"use client";
import { useCallback, useRef, useState } from "react";
import type { AgentEvent, EventBrief, EventPlan } from "./types";

export function usePlanner() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [plan, setPlan] = useState<EventPlan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (body: { prompt: string; brief?: Partial<EventBrief>; feedback?: string; previous?: EventPlan }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setEvents([]);
    try {
      const res = await fetch("/api/plan", { method: "POST", body: JSON.stringify(body), signal: ctrl.signal, headers: { "Content-Type": "application/json" } });
      if (!res.ok || !res.body) throw new Error(`Planner failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "plan") setPlan(e.plan);
          else if (e.type === "error") setError(e.message);
          setEvents((prev) => [...prev, e]);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);

  return { events, plan, setPlan, running, error, run };
}
