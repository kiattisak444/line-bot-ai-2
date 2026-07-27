import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { getFaqData } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";
import { replyText } from "@/lib/line";

export const runtime = "nodejs";

const GEMINI_TIMEOUT_MS = 7500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function handleTextMessageEvent(
  event: webhook.MessageEvent,
  requestId: string
): Promise<void> {
  const replyToken = event.replyToken;
  if (!replyToken || event.message.type !== "text") return;

  const userMessage = event.message.text;
  let replyMessage = DEFAULT_REPLY;

  try {
    const faq = await getFaqData();
    const result = await withTimeout(askGemini(userMessage, faq), GEMINI_TIMEOUT_MS);
    if (!result.isTruncated && result.text) {
      replyMessage = result.text;
    }
  } catch (err) {
    console.error(`[line-webhook][${requestId}] failed to build AI reply, falling back to default:`, err);
  }

  try {
    await replyText(replyToken, replyMessage);
  } catch (err) {
    // replyToken is single-use and expires fast — nothing to retry, just log.
    console.error(`[line-webhook][${requestId}] replyMessage failed:`, err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelSecret) {
      console.error("[line-webhook] LINE_CHANNEL_SECRET is not set");
      return NextResponse.json({}, { status: 200 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-line-signature") ?? "";

    if (!validateSignature(rawBody, channelSecret, signature)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as webhook.CallbackRequest;
    const events = body.events ?? [];

    // Never let one event's failure block another, and never throw out of
    // this handler — LINE will retry-storm a webhook that doesn't 200.
    await Promise.all(
      events.map(async (event) => {
        const requestId = event.webhookEventId || crypto.randomUUID();
        try {
          if (event.type === "message" && event.message.type === "text") {
            await handleTextMessageEvent(event, requestId);
          }
        } catch (err) {
          console.error(`[line-webhook][${requestId}] unhandled event error:`, err);
        }
      })
    );

    return NextResponse.json({}, { status: 200 });
  } catch (err) {
    console.error("[line-webhook] unexpected error:", err);
    return NextResponse.json({}, { status: 200 });
  }
}
