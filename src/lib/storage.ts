import type { EventPlan } from "./types";

const KEY = "eventpilot.plans.v1";

export function loadPlans(): EventPlan[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function savePlan(plan: EventPlan) {
  const all = loadPlans().filter((p) => p.id !== plan.id);
  localStorage.setItem(KEY, JSON.stringify([plan, ...all].slice(0, 20)));
}

export function deletePlan(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadPlans().filter((p) => p.id !== id)));
}
