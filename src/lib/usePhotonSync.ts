"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AgentEvent, EventPlan, TextMessage } from "./types";
import { savePlan } from "./storage";

export type Live = { configured: boolean; platform?: string; agent?: string; organizer?: string; linked?: boolean; error?: string; working?: string | null };
export type PhotonState = { live: Live | null; thread: TextMessage[]; planning?: { title: string; events: AgentEvent[] } | null; active?: { id: string; title: string } | null };

export const PhotonContext = createContext<PhotonState>({ live: null, thread: [] });
export const usePhoton = () => useContext(PhotonContext);

const FRESH_MS = 10 * 60_000;

/**
 * Keeps the open plan in sync with the server-side Photon agent, which runs one event by text at a time.
 * Each event stays separate: the server's event only replaces the open one if it's the same event, and an
 * event only becomes the texting event when it's created or edited here, never just by opening it.
 */
export function usePhotonSync(plan: EventPlan | null, setPlan: (p: EventPlan) => void, onRemote: () => void): PhotonState {
  const [state, setState] = useState<PhotonState>({ live: null, thread: [] });
  const rev = useRef(-1);
  const synced = useRef("");
  const pushing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serverId = useRef<string | null>(null);
  const base = useRef<{ id: string; json: string } | null>(null);
  const planRef = useRef(plan);
  const cb = useRef({ setPlan, onRemote });
  useEffect(() => {
    planRef.current = plan;
    cb.current = { setPlan, onRemote };
  }, [plan, setPlan, onRemote]);

  const adopt = useCallback((p: EventPlan, open: boolean) => {
    synced.current = JSON.stringify(p);
    savePlan(p);
    if (open) cb.current.setPlan(p);
    cb.current.onRemote();
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (pushing.current || timer.current) return;
      try {
        const r = await fetch(`/api/photon?rev=${rev.current}`);
        const j = (await r.json()) as { live: Live; rev?: number; thread?: TextMessage[]; plan?: EventPlan | null; planning?: PhotonState["planning"]; active?: PhotonState["active"] };
        if (stop || pushing.current || timer.current) return;
        setState({ live: j.live, thread: j.thread ?? [], planning: j.planning ?? null, active: j.active ?? null });
        if (!j.live?.configured || typeof j.rev !== "number" || j.rev === rev.current) return;
        const first = rev.current === -1;
        rev.current = j.rev;
        if (!j.plan) return;
        serverId.current = j.plan.id;
        const json = JSON.stringify(j.plan);
        if (json === synced.current) return;
        const open = planRef.current;
        if (open?.id === j.plan.id) base.current = { id: j.plan.id, json };
        adopt(j.plan, open ? open.id === j.plan.id : !first);
      } catch {
        if (!stop) setState((s) => (s.live?.configured ? { ...s, live: { ...s.live, error: "Couldn't reach the server" } } : s));
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [adopt]);

  const configured = !!state.live?.configured;
  const [retry, setRetry] = useState(0);
  const reachable = configured && !state.live?.error;
  useEffect(() => {
    if (!reachable || !plan || rev.current === -1) return;
    const json = JSON.stringify(plan);
    if (json === synced.current) return;
    const isServer = plan.id === serverId.current;
    if (base.current?.id !== plan.id) {
      base.current = { id: plan.id, json };
      if (!isServer && Date.now() - Date.parse(plan.createdAt) > FRESH_MS) return;
    } else if (!isServer && json === base.current.json) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      pushing.current = true;
      timer.current = undefined;
      const body = planRef.current!;
      try {
        const send = () => fetch("/api/photon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: body, rev: rev.current }) });
        let r = await send();
        let j = (await r.json()) as { rev?: number; plan?: EventPlan | null };
        if (typeof j.rev === "number") rev.current = j.rev;
        // This event was created or edited here, so it becomes the texting event even if another one was active.
        if (r.status === 409 && j.plan && j.plan.id !== body.id) {
          r = await send();
          j = (await r.json()) as { rev?: number; plan?: EventPlan | null };
          if (typeof j.rev === "number") rev.current = j.rev;
        }
        if (r.status === 409 && j.plan) {
          serverId.current = j.plan.id;
          adopt(j.plan, j.plan.id === body.id);
          if (j.plan.id !== body.id) setTimeout(() => setRetry((n) => n + 1), 5000);
        } else if (r.ok) {
          synced.current = JSON.stringify(body);
          serverId.current = body.id;
          base.current = { id: body.id, json: synced.current };
        }
        else setTimeout(() => setRetry((n) => n + 1), 5000);
      } catch {
        setTimeout(() => setRetry((n) => n + 1), 5000);
      } finally {
        pushing.current = false;
      }
    }, 500);
  }, [plan, reachable, adopt, retry]);

  return state;
}
