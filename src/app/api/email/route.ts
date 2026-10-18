import { mailConfig, sendEmail } from "@/lib/mailer";

export const runtime = "nodejs";

export async function GET() {
  const c = mailConfig();
  return Response.json({ live: !!c, from: c?.from, redirect: c?.redirect });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { to?: unknown; subject?: unknown; body?: unknown; title?: unknown };
  if (typeof b.to !== "string" || typeof b.subject !== "string" || typeof b.body !== "string") return Response.json({ error: "to, subject and body are required" }, { status: 400 });
  if (!mailConfig()) return Response.json({ simulated: true });
  const r = await sendEmail({ to: b.to.slice(0, 200), subject: b.subject.slice(0, 200), body: b.body.slice(0, 20000) }, typeof b.title === "string" ? b.title.slice(0, 120) : "EventPilot");
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
