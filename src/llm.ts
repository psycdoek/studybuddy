import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import type { Turn } from "./db.js";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return (client ??= new GoogleGenAI({ apiKey }));
}

export interface GeminiAttachment { mimeType: string; data: string; }

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
    const response = await getClient().models.generateContent({
      model,
      contents,
      config: { systemInstruction: system, temperature: 0.7, maxOutputTokens: 1200 },
    });
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
  const response = await getClient().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `Extract durable, non-sensitive study facts about the student from this exchange. Return only a JSON array of short strings. Exclude transcript details and anything uncertain. Return [] if there are no useful facts.\n\n${exchange}` }] }],
    config: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "STRING" } }, temperature: 0.1, maxOutputTokens: 300 },
  });
  const parsed: unknown = JSON.parse(response.text ?? "[]");
  if (!Array.isArray(parsed)) throw new Error("Gemini fact extraction did not return an array");
  return parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
}
