import { messagingApi } from '@line/bot-sdk';
import { config } from '../config.js';
import { appendLog } from '../lib/db.js';

const { MessagingApiClient, MessagingApiBlobClient } = messagingApi;

let client;
let blobClient;

function getClient() {
  if (!client) client = new MessagingApiClient({ channelAccessToken: config.line.channelAccessToken });
  return client;
}
function getBlobClient() {
  if (!blobClient) blobClient = new MessagingApiBlobClient({ channelAccessToken: config.line.channelAccessToken });
  return blobClient;
}

function logPush(to, message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  appendLog(to, to, 'BOT', text, 'BOT');
}

/** Thin wrapper mirroring LINE.gs's makeLINEClient(), backed by the official @line/bot-sdk. */
export function makeLINEClient() {
  return {
    async pushMessage(to, text) {
      await getClient().pushMessage({ to, messages: [{ type: 'text', text }] });
      await logPush(to, text);
    },
    async pushFlex(to, messages) {
      await getClient().pushMessage({ to, messages });
      await logPush(to, messages);
    },
    async pushQuickReply(to, text, quickReply) {
      await getClient().pushMessage({ to, messages: [{ type: 'text', text, quickReply }] });
      await logPush(to, text);
    },
    async replyText(replyToken, text) {
      const trimmed = text.slice(0, 1900);
      await getClient().replyMessage({ replyToken, messages: [{ type: 'text', text: trimmed }] });
    },
    async replyFlex(replyToken, messages) {
      await getClient().replyMessage({ replyToken, messages });
    },
    /** Returns a Readable stream of the message's binary content (image/video/file). */
    async getContent(messageId) {
      return getBlobClient().getMessageContent(messageId);
    },
    async getContentWithHttpInfo(messageId) {
      return getBlobClient().getMessageContentWithHttpInfo(messageId);
    },
    async getUserProfile(userId) {
      return getClient().getProfile(userId);
    },
    async getGroupMemberProfile(groupId, userId) {
      return getClient().getGroupMemberProfile(groupId, userId);
    },
    async getRoomMemberProfile(roomId, userId) {
      return getClient().getRoomMemberProfile(roomId, userId);
    },
  };
}
