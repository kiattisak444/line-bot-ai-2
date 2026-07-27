export interface FaqItem {
  category: string;
  question: string;
  answer: string;
  note?: string;
  imageUrl?: string;
}

export type FinishReason = "STOP" | "MAX_TOKENS" | string;

export interface GeminiResult {
  text: string | null;
  finishReason: FinishReason | null;
  thoughtsTokenCount: number | null;
  candidatesTokenCount: number | null;
  isTruncated: boolean;
}
