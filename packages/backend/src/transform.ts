import crypto from "node:crypto";
import type {
  AttachmentInput,
  ChatMessageInput,
  ChatResponse,
  SquareA2AContentPart,
  SquareA2AMessage
} from "./types.js";

const A2A_VERSION = "0.1-bridge";

const randomId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

export function toSquareA2AMessage(input: ChatMessageInput, recipientAgentId: string): SquareA2AMessage {
  const text = (input.text ?? "").trim();
  const attachments = input.attachments ?? [];
  const content: SquareA2AContentPart[] = [];

  if (text) {
    content.push({ type: "text", text });
  }

  const imageAttachments = attachments.filter((a) => a.type === "image");
  const audioAttachments = attachments.filter((a) => a.type === "audio");

  for (const image of imageAttachments) {
    if (image.url?.trim()) {
      content.push({
        type: "image_url",
        url: image.url.trim(),
        name: image.name?.trim()
      });
      continue;
    }
    if (image.dataBase64?.trim()) {
      content.push({
        type: "image_base64",
        data: image.dataBase64.trim(),
        media_type: image.mediaType?.trim() || "image/png",
        name: image.name?.trim()
      });
    }
  }

  // Square/Brute canonical A2A currently validates only text/image content parts.
  // Audio is preserved as metadata for forward compatibility.
  if (content.length === 0 && audioAttachments.length > 0) {
    content.push({ type: "text", text: "Audio attachment included in metadata." });
  }

  return {
    a2a_version: A2A_VERSION,
    message_id: randomId(),
    conversation_id: input.conversationId,
    recipient: { agent_id: recipientAgentId },
    content,
    metadata: {
      ...(input.metadata ?? {}),
      triangle: {
        media: {
          audio: audioAttachments
        }
      }
    }
  };
}

export function fromSquareResponse(raw: any): ChatResponse {
  const root = raw ?? {};
  const message = root.message ?? root.response ?? root;

  const content: any[] = Array.isArray(message.content) ? message.content : [];
  const textChunks: string[] = [];
  const attachments: AttachmentInput[] = [];

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const type = String(part.type ?? "").trim();
    if (type === "text") {
      const text = String(part.text ?? "").trim();
      if (text) {
        textChunks.push(text);
      }
    }
    if (type === "image_url") {
      attachments.push({
        type: "image",
        name: typeof part.name === "string" ? part.name : undefined,
        url: typeof part.url === "string" ? part.url : undefined
      });
    }
    if (type === "image_base64") {
      attachments.push({
        type: "image",
        name: typeof part.name === "string" ? part.name : undefined,
        mediaType: typeof part.media_type === "string" ? part.media_type : undefined,
        dataBase64: typeof part.data === "string" ? part.data : undefined
      });
    }
  }

  const metaAudio = message?.metadata?.triangle?.media?.audio;
  if (Array.isArray(metaAudio)) {
    for (const audio of metaAudio) {
      if (!audio || typeof audio !== "object") {
        continue;
      }
      attachments.push({
        type: "audio",
        name: typeof audio.name === "string" ? audio.name : undefined,
        mediaType: typeof audio.mediaType === "string" ? audio.mediaType : undefined,
        dataBase64: typeof audio.dataBase64 === "string" ? audio.dataBase64 : undefined,
        url: typeof audio.url === "string" ? audio.url : undefined
      });
    }
  }

  const text = textChunks.join("\n") || (typeof message.result === "string" ? message.result : "");

  return {
    conversationId: typeof message.conversation_id === "string" ? message.conversation_id : undefined,
    requestId: typeof root.request_id === "string" ? root.request_id : undefined,
    messages: [
      {
        id: randomId(),
        role: "assistant",
        text,
        attachments,
        createdAt: new Date().toISOString()
      }
    ],
    raw
  };
}
