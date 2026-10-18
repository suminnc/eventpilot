import { runPlanner } from "@/lib/agents/orchestrator";
import { planToMarkdown } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Non-streaming endpoint for external agents (e.g. the Fetch.ai uAgent bridge in /agents).
 * POST { "prompt": "..." } → { plan, markdown }
 */
export async function POST(req: Request) {
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const plan = await runPlanner({ prompt }, () => {});
  return Response.json({ plan, markdown: planToMarkdown(plan) });
}
