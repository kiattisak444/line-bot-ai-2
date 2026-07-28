import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { getFaqData } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";
import { replyText, replyMenuCarousel } from "@/lib/line";
import type { FaqItem } from "@/types";

export const runtime = "nodejs";

const MENU_KEYWORD = "เมนู";

// Best-effort only: state lives in a warm serverless instance's memory, not
// shared across instances. Still catches the common case (LINE redelivery,
// a burst of spam) without needing an external store.
const DEDUP_TTL_MS = 5 * 60_000;
const seenEventIds = new Map<string, number>();

function isDuplicateEvent(id: string): boolean {
  const now = Date.now();
  for (const [key, ts] of seenEventIds) {
    if (now - ts > DEDUP_TTL_MS) seenEventIds.delete(key);
  }
  if (seenEventIds.has(id)) return true;
  seenEventIds.set(id, now);
  return false;
}

const RATE_LIMIT_WINDOW_MS = 20_000;
const RATE_LIMIT_MAX = 6;
const rateLimitState = new Map<string, { count: number; windowStart: number }>();

function rateLimitKeyFor(event: webhook.MessageEvent): string {
  const source = event.source;
  if (source?.type === "user") return `user:${source.userId}`;
  if (source?.type === "group") return `group:${source.groupId}`;
  if (source?.type === "room") return `room:${source.roomId}`;
  return "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const state = rateLimitState.get(key);
  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(key, { count: 1, windowStart: now });
    return false;
  }
  state.count++;
  return state.count > RATE_LIMIT_MAX;
}

async function handleTextMessageEvent(
  event: webhook.MessageEvent,
  requestId: string
): Promise<void> {
  const replyToken = event.replyToken;
  if (!replyToken || event.message.type !== "text") return;

  const userMessage = event.message.text;

  let faq: FaqItem[] = [];
  try {
    faq = await getFaqData();
  } catch (err) {
    console.error(`[line-webhook][${requestId}] failed to load FAQ data:`, err);
  }

  if (userMessage.includes(MENU_KEYWORD)) {
    const menuItems = faq.filter((item) => item.imageUrl);
    if (menuItems.length > 0) {
      try {
        await replyMenuCarousel(replyToken, menuItems);
        return;
      } catch (err) {
        console.error(`[line-webhook][${requestId}] replyMenuCarousel failed, falling back to text reply:`, err);
      }
    }
  }

  let replyMessage = DEFAULT_REPLY;
  try {
    const result = await askGemini(userMessage, faq);
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
            if (isDuplicateEvent(requestId)) {
              console.log(`[line-webhook][${requestId}] duplicate event, skipping`);
              return;
            }
            const rateLimitKey = rateLimitKeyFor(event);
            if (isRateLimited(rateLimitKey)) {
              console.warn(`[line-webhook][${requestId}] rate limited: ${rateLimitKey}`);
              return;
            }
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
