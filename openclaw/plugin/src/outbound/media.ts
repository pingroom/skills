import { buildOutboundMediaLoadOptions, extensionForMime, type OutboundMediaAccess } from "openclaw/plugin-sdk/media-runtime";
import { loadWebMediaRaw } from "openclaw/plugin-sdk/web-media";
import { resolveOutboundMediaUrls } from "openclaw/plugin-sdk/reply-payload";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT } from "../constants.js";
import type { SendContext } from "./send.js";

export interface MediaContext {
  mediaUrl?: string;
  mediaAccess?: OutboundMediaAccess;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  payload?: { mediaUrl?: string; mediaUrls?: string[] };
}

/** Keep OpenClaw's filesystem and remote-fetch checks on every attachment read. */
export async function uploadMedia(ctx: MediaContext, send: SendContext): Promise<string[]> {
  const urls = resolveOutboundMediaUrls({
    ...ctx.payload,
    mediaUrl: ctx.payload?.mediaUrl ?? ctx.mediaUrl,
  }).map((url) => url.trim()).filter(Boolean);
  if (urls.length > ATTACHMENT_MAX_COUNT) {
    throw new Error(`A PingRoom reply can include at most ${ATTACHMENT_MAX_COUNT} attachments.`);
  }
  if (urls.length === 0) return [];

  const options = buildOutboundMediaLoadOptions({
    maxBytes: ATTACHMENT_MAX_BYTES,
    mediaAccess: ctx.mediaAccess,
    mediaLocalRoots: ctx.mediaLocalRoots,
    mediaReadFile: ctx.mediaReadFile,
  });
  const ids: string[] = [];
  for (const url of urls) {
    const media = await loadWebMediaRaw(url, options);
    const uploaded = await send.sdk.attachments.upload({
      content: media.buffer,
      filename: media.fileName ?? `attachment${extensionForMime(media.contentType) ?? ".bin"}`,
      ...(media.contentType ? { contentType: media.contentType } : {}),
    });
    ids.push(uploaded.id);
  }
  return ids;
}
