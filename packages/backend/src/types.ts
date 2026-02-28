export type AttachmentType = "image" | "audio";

export interface AttachmentInput {
  type: AttachmentType;
  name?: string;
  mediaType?: string;
  dataBase64?: string;
  url?: string;
}

export interface ChatMessageInput {
  conversationId?: string;
  recipientAgentId?: string;
  text?: string;
  attachments?: AttachmentInput[];
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text?: string;
  attachments?: AttachmentInput[];
  createdAt?: string;
}

export interface ChatResponse {
  conversationId?: string;
  requestId?: string;
  messages: ChatMessage[];
  raw?: unknown;
}

export interface SquareA2AContentPart {
  type: "text" | "image_url" | "image_base64";
  text?: string;
  url?: string;
  data?: string;
  media_type?: string;
  name?: string;
}

export interface SquareA2AMessage {
  a2a_version?: string;
  message_id?: string;
  conversation_id?: string;
  recipient?: { agent_id: string; name?: string };
  content: SquareA2AContentPart[];
  metadata?: Record<string, unknown>;
}
