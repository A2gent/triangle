import type { SquareTransport } from "./config.js";
import type { AgentProfile, SquareA2AMessage } from "./types.js";

interface SquareClientConfig {
  baseUrl: string;
  apiKey: string;
  transports: SquareTransport[];
}

export class SquareClient {
  private readonly cfg: SquareClientConfig;
  private cachedAuthenticatedAgentID?: string;
  private cachedAuthenticatedAgentRaw?: any;

  constructor(cfg: SquareClientConfig) {
    this.cfg = cfg;
  }

  get apiKeyPrefix(): string {
    return this.cfg.apiKey.slice(0, 4).toLowerCase();
  }

  async getAuthenticatedAgentID(): Promise<string> {
    const profile = await this.getAuthenticatedAgentProfile();
    return profile.id;
  }

  async getAuthenticatedAgentProfile(): Promise<AgentProfile> {
    if (this.cachedAuthenticatedAgentRaw) {
      return this.normalizeAgent(this.cachedAuthenticatedAgentRaw);
    }
    const parsed = await this.getJSON("/agents/me", "failed to resolve target agent from API key");
    this.cachedAuthenticatedAgentRaw = parsed;
    const profile = this.normalizeAgent(parsed);
    this.cachedAuthenticatedAgentID = profile.id;
    return profile;
  }

  async getAgentProfile(agentID: string): Promise<AgentProfile> {
    const id = agentID.trim();
    if (!id) {
      throw new Error("agent id is required");
    }
    if (this.cachedAuthenticatedAgentID && this.cachedAuthenticatedAgentID === id && this.cachedAuthenticatedAgentRaw) {
      return this.normalizeAgent(this.cachedAuthenticatedAgentRaw);
    }
    const parsed = await this.getJSON(`/agents/${encodeURIComponent(id)}`, `failed to resolve agent ${id}`);
    return this.normalizeAgent(parsed);
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
    return this.assertA2ASuccess(res, "a2a_http");
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
    this.assertProxySuccess(res);
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
      return this.assertA2ASuccess(finalMessage, "a2a_stream");
    }
    if (finalError) {
      throw new Error(finalError);
    }
    throw new Error("stream ended without final message event");
  }

  private assertA2ASuccess(response: any, transport: "a2a_http" | "a2a_stream"): any {
    const statusState = String(response?.status?.state ?? "")
      .trim()
      .toLowerCase();
    const statusCode = String(response?.status?.code ?? "").trim();
    const error = typeof response?.error === "string" ? response.error.trim() : "";
    if (statusState === "failed" || statusState === "error" || error) {
      const reason = error || statusCode || statusState || "unknown error";
      throw new Error(`square ${transport} failed: ${reason}`);
    }
    return response;
  }

  private assertProxySuccess(response: any): void {
    const status = String(response?.status ?? "")
      .trim()
      .toLowerCase();
    const error = typeof response?.error === "string" ? response.error.trim() : "";
    if ((status && status !== "completed") || error) {
      const reason = error || status || "unknown error";
      throw new Error(`square proxy_http failed: ${reason}`);
    }
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

  private async getJSON(path: string, context: string): Promise<any> {
    const url = new URL(path, this.cfg.baseUrl).toString();
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": this.cfg.apiKey
      }
    });
    const bodyText = await resp.text();
    if (!resp.ok) {
      throw new Error(`${context}: status ${resp.status}: ${bodyText}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error(`${context}: invalid JSON response`);
    }
    return parsed;
  }

  private normalizeAgent(raw: any): AgentProfile {
    const id = this.readString(raw, [
      "id",
      "agent_id",
      "agentId",
      "metadata.agent.id"
    ]);
    if (!id) {
      throw new Error("agent response missing id");
    }

    const name =
      this.readString(raw, ["name", "display_name", "displayName", "title"]) ||
      `Agent ${id.slice(0, 8)}`;
    const avatarUrl = this.readString(raw, [
      "avatar_url",
      "avatarUrl",
      "image_url",
      "imageUrl",
      "profile_image_url",
      "profileImageUrl",
      "photo_url",
      "photoUrl"
    ]);

    return { id, name, avatarUrl: avatarUrl || undefined };
  }

  private readString(raw: any, paths: string[]): string {
    for (const path of paths) {
      const value = this.readPath(raw, path);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  private readPath(raw: any, path: string): unknown {
    const parts = path.split(".");
    let curr = raw;
    for (const part of parts) {
      if (!curr || typeof curr !== "object" || !(part in curr)) {
        return undefined;
      }
      curr = curr[part];
    }
    return curr;
  }
}
