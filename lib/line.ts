import { messagingApi } from "@line/bot-sdk";

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
