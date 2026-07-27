import { messagingApi } from "@line/bot-sdk";
import type { FaqItem } from "@/types";

const MAX_CAROUSEL_BUBBLES = 12; // LINE Flex Carousel hard limit

let client: messagingApi.MessagingApiClient | null = null;

function getClient(): messagingApi.MessagingApiClient {
  if (!client) {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelAccessToken) {
      throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
    }
    client = new messagingApi.MessagingApiClient({ channelAccessToken });
  }
  return client;
}

/**
 * Replies with a single text message. replyToken is single-use and expires
 * quickly, so callers must not retry on failure — just log and move on.
 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await getClient().replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

function menuItemToBubble(item: FaqItem): messagingApi.FlexBubble {
  return {
    type: "bubble",
    hero: {
      type: "image",
      url: item.imageUrl!,
      size: "full",
      aspectRatio: "1:1",
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        { type: "text", text: item.question, weight: "bold", size: "lg", wrap: true },
        { type: "text", text: item.answer, size: "sm", color: "#888888", wrap: true },
      ],
    },
  };
}

/**
 * Replies with a Flex Carousel of menu items, one card per FaqItem with an
 * image. LINE caps carousels at 12 bubbles, so extra items are dropped.
 */
export async function replyMenuCarousel(replyToken: string, items: FaqItem[]): Promise<void> {
  const bubbles = items.slice(0, MAX_CAROUSEL_BUBBLES).map(menuItemToBubble);

  await getClient().replyMessage({
    replyToken,
    messages: [
      {
        type: "flex",
        altText: "เมนูร้านของเรา",
        contents: { type: "carousel", contents: bubbles },
      },
    ],
  });
}
