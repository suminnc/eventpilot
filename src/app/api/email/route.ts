import { mailConfig, sendEmail } from "../../../lib/mailer";
import { mailStatus, sendOutbox } from "../../../lib/photonAgent";

export const runtime = "nodejs";

export async function GET() {
  const c = mailConfig();
  return Response.json({ live: !!c, from: c?.from, redirect: c?.redirect, ...mailStatus() });
}

/** { planId, outboxId } sends from the server's active plan (and tracks vendor replies); { to, subject, body } is a one-off send. */
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { planId?: unknown; outboxId?: unknown; to?: unknown; subject?: unknown; body?: unknown; title?: unknown } | null;
  if (!j) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  if (typeof j.planId === "string" && typeof j.outboxId === "string") {
    const r = await sendOutbox(j.planId, j.outboxId);
    if (r) return Response.json(r, { status: r.ok ? 200 : 502 });
  }
  if (typeof j.to !== "string" || typeof j.subject !== "string" || typeof j.body !== "string" || !j.to || !j.subject) return Response.json({ ok: false, error: "to, subject and body are required" }, { status: 400 });
  if (!mailConfig()) return Response.json({ simulated: true });
  const r = await sendEmail({ to: j.to.slice(0, 200), subject: j.subject.slice(0, 300), body: j.body.slice(0, 20_000) }, typeof j.title === "string" ? j.title.slice(0, 120) : "EventPilot");
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
