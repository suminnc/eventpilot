/**
 * Minimal OpenAI-compatible chat client. Works with StepFun (step-5-preview),
 * Gemini's OpenAI endpoint, OpenAI, Groq, local Ollama, etc.
 */
export type LLMConfig = { baseUrl: string; apiKey: string; model: string };

export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "step-5-preview",
  };
}

export async function chatJSON<T>(
  cfg: LLMConfig,
  system: string,
  user: string,
  { temperature = 0.6, timeoutMs = 45000 }: { temperature?: number; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nRespond with a single valid JSON object only.` },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    return parseJSONLoose<T>(content);
  } finally {
    clearTimeout(timer);
  }
}

export function parseJSONLoose<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("Model did not return JSON");
  }
}
