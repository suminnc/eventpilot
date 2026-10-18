import { photonConfig } from "@/lib/photon";
import { pushPlan, snapshot, startPhotonAgent } from "@/lib/photonAgent";
import { relay } from "@/lib/relay";
import type { EventPlan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mask = (h: string) => (h.includes("@") ? h.replace(/^(.).*(@.*)$/, "$1•••$2") : `•••${h.slice(-4)}`);

function live() {
  const c = photonConfig();
  if (!c) return null;
  const s = snapshot();
  return { configured: true, platform: c.platform, agent: c.agent, organizer: mask(c.organizer), linked: s.linked, error: s.error, working: s.working };
}

/** GET ?rev=<n> → messaging status, the conversation, and the active plan when it changed since rev. */
export async function GET(req: Request) {
  const l = live();
  if (!l) return (await relay(req, "/api/photon")) ?? Response.json({ live: { configured: false } });
  startPhotonAgent();
  const s = snapshot();
  const rev = Number(new URL(req.url).searchParams.get("rev"));
  return Response.json({ live: l, rev: s.rev, thread: s.thread, planning: s.planning, active: s.plan ? { id: s.plan.id, title: s.plan.brief.title } : null, ...(rev === s.rev ? {} : { plan: s.plan }) });
}

/** POST { plan, rev } → make this the active plan the Photon agent acts on. 409 + server plan if it changed in the meantime. */
export async function POST(req: Request) {
  if (!photonConfig()) return (await relay(req, "/api/photon")) ?? Response.json({ error: "Photon is not configured" }, { status: 400 });
  const { plan, rev } = (await req.json().catch(() => ({}))) as { plan?: EventPlan; rev?: unknown };
  if (!plan || typeof plan.id !== "string" || !plan.brief || typeof rev !== "number") return Response.json({ error: "plan and rev are required" }, { status: 400 });
  const ok = pushPlan(plan, rev);
  const s = snapshot();
  return Response.json({ rev: s.rev, ...(ok ? {} : { plan: s.plan }) }, { status: ok ? 200 : 409 });
}
