import { answerQuestion } from "@/lib/answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Free-form organizer questions (simulated thread). Read-only: the model answers; money only moves on explicit commands. */
export async function POST(req: Request) {
  const { question, context, history } = (await req.json().catch(() => ({}))) as { question?: unknown; context?: unknown; history?: unknown };
  if (typeof question !== "string" || !question.trim() || typeof context !== "string") return Response.json({ error: "question and context are required" }, { status: 400 });
  const reply = await answerQuestion(question, context, Array.isArray(history) ? history : []);
  return Response.json({ reply });
}
