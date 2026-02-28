export type TriangleMediaType = "text" | "image" | "audio";

export interface TriangleAttachment {
  type: Exclude<TriangleMediaType, "text">;
  name?: string;
  mediaType?: string;
  dataBase64?: string;
  url?: string;
}

export interface TriangleMessageInput {
  conversationId?: string;
  recipientAgentId?: string;
  text?: string;
  attachments?: TriangleAttachment[];
  metadata?: Record<string, unknown>;
}

export interface TriangleMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text?: string;
  attachments?: TriangleAttachment[];
  createdAt?: string;
}

export interface TriangleSendResult {
  conversationId?: string;
  requestId?: string;
  messages: TriangleMessage[];
  raw?: unknown;
}

export interface TriangleClientConfig {
  baseUrl: string;
  transport?: "auto" | "ws" | "http";
  wsPath?: string;
  defaultRecipientAgentId?: string;
  connectTimeoutMs?: number;
}
