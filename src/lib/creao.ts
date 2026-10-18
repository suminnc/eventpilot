/**
 * CREAO hosted agent bridge (app-scoped API Trigger). The EventPilot Ops Swarm agent lives on CREAO;
 * EventPilot triggers it with the plan and reads back its decisions. Server-only: never expose the key.
 * Env: CREAO_API_KEY (capi_…), CREAO_APP_ID (from the agent's page on agent.creao.ai).
 */
const BASE = "https://agent.creao.ai/api/v1";

export function creaoConfig() {
  const key = process.env.CREAO_API_KEY, app = process.env.CREAO_APP_ID;
  return key && app ? { key, app } : null;
}

export type CreaoRun = { id: string; status: string; result?: { text?: string; chatText?: string }; errorCode?: string };

async function call(path: string, key: string, init: RequestInit = {}): Promise<CreaoRun> {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as CreaoRun & { error?: string };
  if (!r.ok) throw new Error(`CREAO ${r.status} ${j.error ?? ""}`.trim());
  return j;
}

/** Runs the CREAO swarm agent and waits (polling) up to timeoutMs for its answer. */
export async function runCreaoAgent(inputs: Record<string, string>, timeoutMs = 600_000): Promise<{ ok: true; text: string; runId: string } | { ok: false; error: string }> {
  const c = creaoConfig();
  if (!c) return { ok: false, error: "CREAO not configured" };
  try {
    const run = await call(`/apps/${c.app}/runs`, c.key, { method: "POST", body: JSON.stringify({ inputs }) });
    const until = Date.now() + timeoutMs;
    let cur = run;
    while (!["completed", "failed", "cancelled"].includes(cur.status) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 4000));
      cur = await call(`/apps/${c.app}/runs/${run.id}`, c.key);
    }
    if (cur.status !== "completed") return { ok: false, error: cur.errorCode ?? `run ${cur.status}` };
    return { ok: true, text: cur.result?.text ?? cur.result?.chatText ?? "", runId: run.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "CREAO request failed" };
  }
}
