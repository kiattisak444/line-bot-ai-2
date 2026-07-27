import { GoogleGenAI } from "@google/genai";
import type { FaqItem, GeminiResult } from "@/types";

const MODEL = "gemini-2.5-flash";
const TEMPERATURE = 1.0; // do not lower — required by product brief
const MAX_OUTPUT_TOKENS = 1024;

export const DEFAULT_REPLY =
  "ระบบเรายังไม่มีข้อมูลสำหรับคำถามนี้ ขออภัยในความไม่สะดวกครับ";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function faqToCsv(faq: FaqItem[]): string {
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

  const header = "category,question,answer,note";
  const rows = faq.map((item) =>
    [item.category, item.question, item.answer, item.note ?? ""]
      .map(escape)
      .join(",")
  );

  return [header, ...rows].join("\n");
}

function buildSystemPrompt(faqCsv: string, userMessage: string): string {
  return `<role>
คุณคือพี่ที่ร้านอาหารตามสั่ง ตอบแชทลูกค้าที่ทักเข้ามาทาง LINE
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งราคา เวลา หรือที่ตั้งเพิ่มเติมเอง
- ถ้าไม่มีข้อมูลใน <faq> ที่ตรงกับคำถาม ให้ตอบด้วยข้อความนี้เท่านั้น: "${DEFAULT_REPLY}"
- โทนเป็นกันเอง แบบพี่คุยกับน้อง/ลูกค้า ใช้ emoji ได้พอดีๆ (ไม่ต้องเยอะเกิน)
- ความยาวคำตอบ 2-4 ประโยค ให้รายละเอียดพอสมควร ไม่ตอบห้วนเกินไป
- ห้ามพูดถึงว่าตัวเองเป็น AI หรือ Gemini
</constraints>

<output_format>
ภาษาไทย ไม่ใช้ markdown ไม่ใช้ bullet point ตอบเป็นข้อความแชทธรรมดา
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${userMessage}
</question>`;
}

/**
 * Calls Gemini with the FAQ-grounded system prompt and returns the answer.
 * Always logs finishReason/thoughtsTokenCount/candidatesTokenCount for
 * observability. When finishReason is MAX_TOKENS the text may be cut off
 * mid-sentence, so callers should prefer DEFAULT_REPLY in that case.
 */
export async function askGemini(
  question: string,
  faq: FaqItem[]
): Promise<GeminiResult> {
  const prompt = buildSystemPrompt(faqToCsv(faq), question);

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason ?? null;
  const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount ?? null;
  const candidatesTokenCount =
    response.usageMetadata?.candidatesTokenCount ?? null;

  console.log("[gemini] usage", {
    finishReason,
    thoughtsTokenCount,
    candidatesTokenCount,
  });

  const isTruncated = finishReason === "MAX_TOKENS";

  return {
    text: isTruncated ? null : response.text ?? null,
    finishReason,
    thoughtsTokenCount,
    candidatesTokenCount,
    isTruncated,
  };
}
