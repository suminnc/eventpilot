/** On a deployment without Photon/email (e.g. Vercel), forwards texting + email API calls to the always-on EventPilot server. */
const LIVE_SERVER = "https://wait-chapters-minute-rate.trycloudflare.com";

/** Set EVENTPILOT_SERVER_URL=off on Vercel to keep the public site fully simulated. */
export function relayUrl() {
  const v = process.env.EVENTPILOT_SERVER_URL ?? (process.env.VERCEL ? LIVE_SERVER : "");
  return v && v !== "off" ? v.replace(/\/$/, "") : null;
}

export async function relay(req: Request, path: string): Promise<Response | null> {
  const base = relayUrl();
  if (!base) return null;
  const r = await fetch(`${base}${path}${new URL(req.url).search}`, {
    method: req.method,
    headers: { "content-type": "application/json" },
    body: req.method === "GET" ? undefined : await req.text(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return Response.json({ live: { configured: true, error: "Couldn't reach the texting server" } }, { status: 502 });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
