/**
 * Minimal OpenAI-compatible chat client. Works with StepFun (step-5-preview),
 * Gemini's OpenAI endpoint, OpenAI, Groq, local Ollama, etc.
 */
export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  reasoningEffort: string;
  usage: { calls: number; promptTokens: number; completionTokens: number };
};

export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL || "https://api.stepfun.ai/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "step-5-preview",
    // Only a cap (you pay for tokens used); too low a cap truncates JSON and wastes the whole call.
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || 8000,
    // Reasoning tokens count toward output; "low" cuts them ~3x on step-5-preview. Set "" to omit.
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "low",
    usage: { calls: 0, promptTokens: 0, completionTokens: 0 },
  };
}

export async function chatJSON<T>(
  cfg: LLMConfig,
  system: string,
  user: string,
  opts: { temperature?: number; timeoutMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chatOnce<T>(cfg, system, user, opts);
    } catch (err) {
      // Retry once on transient failures (rate limit, server error, timeout); never on auth/credit/length errors.
      const m = (err as Error).message;
      if (attempt >= 1 || !/LLM (429|5\d\d)|abort|fetch failed|ECONNRESET/i.test(m)) throw new Error(explainLLMError(m));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function explainLLMError(m: string): string {
  if (/LLM 402|insufficient|balance|quota|credit/i.test(m)) return "out of model credit";
  if (/LLM 401|LLM 403/.test(m)) return "API key rejected";
  if (/LLM 429/.test(m)) return "rate limited by the model provider";
  if (/max_tokens/.test(m)) return "response too long";
  if (/abort/i.test(m)) return "model timed out";
  if (/JSON/.test(m)) return "model returned malformed JSON";
  return m.slice(0, 80);
}

async function chatOnce<T>(
  cfg: LLMConfig,
  system: string,
  user: string,
  { temperature = 0.6, timeoutMs = 90000 }: { temperature?: number; timeoutMs?: number },
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
        max_tokens: cfg.maxTokens,
        ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nRespond with a single valid JSON object only.` },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    cfg.usage.calls += 1;
    cfg.usage.promptTokens += data.usage?.prompt_tokens ?? 0;
    cfg.usage.completionTokens += data.usage?.completion_tokens ?? 0;
    if (data.choices?.[0]?.finish_reason === "length") throw new Error("hit max_tokens");
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
