import { GoogleGenAI } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { Turn } from "./db.js";

const apiKey = process.env.GEMINI_API_KEY;
const models = [...new Set(
  (process.env.GEMINI_MODELS?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
)];
const MODEL_COOLDOWN_MS = 60_000;
const modelCooldowns = new Map<string, number>();
let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return (client ??= new GoogleGenAI({ apiKey }));
}

export interface GeminiAttachment { mimeType: string; data: string; }

function isRetryable(error: unknown): boolean {
  const value = error as { status?: number; code?: number | string; message?: string; error?: { code?: number; status?: string; message?: string } };
  const status = Number(value?.status ?? value?.code ?? value?.error?.code);
  const message = `${value?.message ?? ""} ${value?.error?.status ?? ""} ${value?.error?.message ?? ""}`;
  return [408, 429, 500, 502, 503, 504].includes(status) ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|overload|too many requests|temporarily unavailable|try again later/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(contents: Content[], config: GenerateContentConfig) {
  let lastError: unknown;
  const now = Date.now();
  const availableModels = models.filter((model) => (modelCooldowns.get(model) ?? 0) <= now);
  const modelsToTry = availableModels.length > 0 ? availableModels : models;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await getClient().models.generateContent({ model, contents, config });
        if (model !== models[0]) console.warn(`[llm] using fallback model ${model}`);
        modelCooldowns.delete(model);
        return response;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) throw error;
        console.warn(`[llm] ${model} failed (${attempt === 0 ? "retrying" : "switching model"}):`, error);
        if (attempt === 0) await wait(700 + Math.random() * 500);
        else modelCooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
      }
    }
  }
  throw lastError;
}

export async function chat(system: string, history: Turn[], message: string, attachments: GeminiAttachment[] = []): Promise<string> {
  const currentParts: Part[] = [
    { text: message },
    ...attachments.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } })),
  ];
  const contents: Content[] = [
    ...history.map(({ role, content }) => ({ role: role === "model" ? "model" : "user", parts: [{ text: content }] })),
    { role: "user", parts: currentParts },
  ];
  const parts: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await generateWithFallback(contents, { systemInstruction: system, temperature: 0.7, maxOutputTokens: 1200 });
    const text = response.text?.trim();
    if (!text && parts.length === 0) throw new Error("Gemini returned an empty response");
    if (text) parts.push(text);
    if (response.candidates?.[0]?.finishReason !== "MAX_TOKENS" || attempt === 1) break;
    contents.push(
      { role: "model", parts: [{ text: text ?? "" }] },
      { role: "user", parts: [{ text: "Continue the answer from where you stopped. Do not repeat earlier text; finish the explanation and its final sentence." }] },
    );
  }
  return parts.join("\n");
}

export async function extractFacts(exchange: string): Promise<string[]> {
  const response = await generateWithFallback(
    [{ role: "user", parts: [{ text: `Extract durable, non-sensitive study facts about the student from this exchange. Return only a JSON array of short strings. Exclude transcript details and anything uncertain. Return [] if there are no useful facts.\n\n${exchange}` }] }],
    { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "STRING" } }, temperature: 0.1, maxOutputTokens: 300 },
  );
  const parsed: unknown = JSON.parse(response.text ?? "[]");
  if (!Array.isArray(parsed)) throw new Error("Gemini fact extraction did not return an array");
  return parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
}
