import { makeLINEClient } from './client.js';
import { makeKeyCache } from '../lib/cache.js';

async function getDisplayName(gType, gId, userId) {
  const cache = makeKeyCache(userId);
  const cached = cache.get();
  if (cached !== null) return cached;

  const client = makeLINEClient();
  let profile;
  if (gType === 'group') {
    profile = await client.getGroupMemberProfile(gId, userId);
  } else if (gType === 'room') {
    profile = await client.getRoomMemberProfile(gId, userId);
  } else {
    profile = await client.getUserProfile(userId);
  }
  cache.put(profile.displayName, 60 * 60);
  return profile.displayName;
}

/** Normalises one LINE webhook event, mirroring LINE.gs's makeLINEPostInfo(). */
export async function makeLINEPostInfo(jPost) {
  const gType = jPost.source.type;
  const replyToken = jPost.replyToken;
  const userId = jPost.source.userId;
  const gID = jPost.source.groupId ?? jPost.source.roomId;
  const mInfo = jPost.message;
  const sname = gType === 'group' || gType === 'room' ? gID : userId;

  const dName = await getDisplayName(gType, gID, userId);
  const client = makeLINEClient();

  return {
    type: jPost.type,
    reply_token: replyToken,
    gType,
    userId,
    gID,
    dName,
    mType: mInfo ? mInfo.type : null,
    mID: mInfo ? mInfo.id : null,
    message: mInfo ? mInfo.text : undefined,
    cType: mInfo?.contentProvider ? mInfo.contentProvider.type : null,
    keywords: mInfo ? mInfo.keywords : null,
    timestamp: jPost.timestamp,
    sname,
    async getContent() {
      if (!mInfo?.id) return { stream: null, contentType: null };
      const response = await client.getContentWithHttpInfo(mInfo.id);
      return {
        stream: response.body,
        contentType: response.httpResponse.headers.get('content-type'),
      };
    },
    async replay(message, name) {
      if (typeof message === 'string') {
        await client.replyText(replyToken, `${name}${message}`);
      } else {
        await client.replyFlex(replyToken, message);
      }
    },
  };
}
