import type { SquareTransport } from "./config.js";
import type { SquareA2AMessage } from "./types.js";

interface SquareClientConfig {
  baseUrl: string;
  apiKey: string;
  transports: SquareTransport[];
}

export class SquareClient {
  private readonly cfg: SquareClientConfig;
  private cachedAuthenticatedAgentID?: string;

  constructor(cfg: SquareClientConfig) {
    this.cfg = cfg;
  }

  get apiKeyPrefix(): string {
    return this.cfg.apiKey.slice(0, 4).toLowerCase();
  }

  async getAuthenticatedAgentID(): Promise<string> {
    if (this.cachedAuthenticatedAgentID) {
      return this.cachedAuthenticatedAgentID;
    }
    const url = new URL("/agents/me", this.cfg.baseUrl).toString();
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": this.cfg.apiKey
      }
    });
    const bodyText = await resp.text();
    if (!resp.ok) {
      throw new Error(`failed to resolve target agent from API key: status ${resp.status}: ${bodyText}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error("failed to resolve target agent from API key: invalid /agents/me response");
    }
    const id = typeof parsed?.id === "string" ? parsed.id.trim() : "";
    if (!id) {
      throw new Error("failed to resolve target agent from API key: /agents/me returned empty id");
    }
    this.cachedAuthenticatedAgentID = id;
    return id;
  }

  async sendMessage(message: SquareA2AMessage): Promise<any> {
    const errors: string[] = [];
    for (const transport of this.cfg.transports) {
      try {
        if (transport === "a2a_stream") {
          return await this.sendA2AStream(message);
        }
        if (transport === "a2a_http") {
          return await this.sendA2AHttp(message);
        }
        if (transport === "proxy_http") {
          return await this.sendProxyHttp(message);
        }
      } catch (err) {
        errors.push(`${transport}: ${(err as Error).message}`);
      }
    }
    throw new Error(`all transports failed: ${errors.join(" | ")}`);
  }

  private async sendA2AHttp(message: SquareA2AMessage): Promise<any> {
    const res = await this.post("/a2a/messages/send", message);
    return res;
  }

  private async sendProxyHttp(message: SquareA2AMessage): Promise<any> {
    const targetAgentID = message.recipient?.agent_id;
    if (!targetAgentID) {
      throw new Error("recipient.agent_id is required for proxy fallback");
    }
    const res = await this.post("/proxy/request", {
      target_agent_id: targetAgentID,
      payload: message
    });

    if (res?.response) {
      return {
        request_id: res.request_id,
        message: res.response
      };
    }
    return res;
  }

  private async sendA2AStream(message: SquareA2AMessage): Promise<any> {
    const url = new URL("/a2a/messages/send/stream", this.cfg.baseUrl).toString();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.cfg.apiKey,
        Accept: "text/event-stream"
      },
      body: JSON.stringify(message)
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`stream request failed with status ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let eventData = "";
    let finalMessage: any = null;
    let finalError = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        eventType = "";
        eventData = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          }
          if (line.startsWith("data:")) {
            eventData += line.slice(5).trim();
          }
        }
        if (!eventData) {
          continue;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(eventData);
        } catch {
          continue;
        }

        if (eventType === "message") {
          finalMessage = parsed;
        }
        if (eventType === "status" && parsed?.state === "failed") {
          finalError = String(parsed.error ?? "stream request failed");
        }
      }
    }

    if (finalMessage) {
      return finalMessage;
    }
    if (finalError) {
      throw new Error(finalError);
    }
    throw new Error("stream ended without final message event");
  }

  private async post(path: string, payload: unknown): Promise<any> {
    const url = new URL(path, this.cfg.baseUrl).toString();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.cfg.apiKey
      },
      body: JSON.stringify(payload)
    });

    const bodyText = await resp.text();
    if (!resp.ok) {
      throw new Error(`status ${resp.status}: ${bodyText}`);
    }
    if (!bodyText.trim()) {
      return {};
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      return { raw: bodyText };
    }
  }
}
