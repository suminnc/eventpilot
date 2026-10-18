import { ApiError } from "@photon-ai/api";
import { isLinked, organizerReplies, photonConfig, textOrganizer } from "@/lib/photon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mask = (h: string) => (h.includes("@") ? h.replace(/^(.).*(@.*)$/, "$1•••$2") : `•••${h.slice(-4)}`);
const fail = (e: unknown) => Response.json({ error: e instanceof ApiError ? `Photon API ${e.status}` : "Photon request failed" }, { status: 502 });

/** GET ?since=<ms> → config + organizer replies since then. */
export async function GET(req: Request) {
  const c = photonConfig();
  if (!c) return Response.json({ configured: false });
  const info = { configured: true, platform: c.platform, agent: c.agent, organizer: mask(c.organizer) };
  const since = Number(new URL(req.url).searchParams.get("since"));
  if (!since) return Response.json({ ...info, linked: isLinked(), messages: [] });
  try {
    const messages = await organizerReplies(new Date(Math.max(since, Date.now() - 7 * 86_400_000) - 5_000));
    return Response.json({ ...info, linked: isLinked(), messages });
  } catch (e) {
    return fail(e);
  }
}

/** POST { text, key } → text the organizer (only the configured organizer can ever be messaged). */
export async function POST(req: Request) {
  if (!photonConfig()) return Response.json({ error: "Photon is not configured" }, { status: 400 });
  const { text, key } = (await req.json().catch(() => ({}))) as { text?: unknown; key?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > 1500 || typeof key !== "string" || !/^[\w:-]{8,120}$/.test(key)) {
    return Response.json({ error: "text and key are required" }, { status: 400 });
  }
  try {
    const status = await textOrganizer(text, key);
    return Response.json({ status }, { status: status === "sent" ? 200 : 409 });
  } catch (e) {
    return fail(e);
  }
}
