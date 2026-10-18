import { runPlanner, type PlanRequest } from "@/lib/agents/orchestrator";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Streams agent events as NDJSON; the last line is {type:"plan"}. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PlanRequest>;
  if (!body.prompt && !body.previous) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Offline agents finish in milliseconds; pace the stream slightly so the live trace is readable.
      const pace = process.env.LLM_API_KEY ? 0 : Number(process.env.OFFLINE_PACE_MS ?? 120);
      let queue = Promise.resolve();
      const send = (e: AgentEvent) => {
        queue = queue.then(async () => {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
          if (pace && e.type !== "plan") await new Promise((r) => setTimeout(r, pace));
        });
      };
      try {
        const plan = await runPlanner({ prompt: body.prompt ?? body.previous!.brief.prompt, brief: body.brief, feedback: body.feedback, previous: body.previous }, send);
        send({ type: "plan", plan, ts: Date.now() });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, ts: Date.now() });
      } finally {
        await queue;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
