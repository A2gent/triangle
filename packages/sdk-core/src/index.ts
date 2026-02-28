import type {
  TriangleClientConfig,
  TriangleMessageInput,
  TriangleSendResult
} from "./types.js";

export * from "./types.js";

interface PendingReq {
  resolve: (value: TriangleSendResult) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class TriangleClient {
  private readonly cfg: Required<Pick<TriangleClientConfig, "wsPath" | "transport" | "connectTimeoutMs">> & TriangleClientConfig;
  private socket?: WebSocket;
  private pending = new Map<string, PendingReq>();

  constructor(config: TriangleClientConfig) {
    this.cfg = {
      wsPath: "/v1/chat/ws",
      transport: "auto",
      connectTimeoutMs: 5000,
      ...config
    };
  }

  async sendMessage(input: TriangleMessageInput): Promise<TriangleSendResult> {
    const payload = {
      ...input,
      recipientAgentId: input.recipientAgentId ?? this.cfg.defaultRecipientAgentId
    };

    if (this.cfg.transport === "http") {
      return this.sendHttp(payload);
    }

    if (this.cfg.transport === "ws" || this.cfg.transport === "auto") {
      try {
        return await this.sendWs(payload);
      } catch (err) {
        if (this.cfg.transport === "ws") {
          throw err;
        }
      }
    }

    return this.sendHttp(payload);
  }

  close(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "client closed");
    }
  }

  private async sendHttp(payload: TriangleMessageInput): Promise<TriangleSendResult> {
    const resp = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body}`);
    }
    return (await resp.json()) as TriangleSendResult;
  }

  private async sendWs(payload: TriangleMessageInput): Promise<TriangleSendResult> {
    await this.ensureSocket();

    const requestId = crypto.randomUUID();
    const envelope = {
      type: "client.message",
      requestId,
      payload
    };

    return await new Promise<TriangleSendResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("WebSocket request timed out"));
      }, 30000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.socket?.send(JSON.stringify(envelope));
    });
  }

  private async ensureSocket(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = this.toWsUrl(this.cfg.baseUrl, this.cfg.wsPath);
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), this.cfg.connectTimeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("WebSocket connection failed"));
      };
    });

    socket.onmessage = (event) => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (parsed?.type === "server.response" && parsed.requestId) {
        const pending = this.pending.get(parsed.requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(parsed.requestId);
        if (parsed.error) {
          pending.reject(new Error(String(parsed.error)));
          return;
        }
        pending.resolve(parsed.payload as TriangleSendResult);
      }
    };

    socket.onclose = () => {
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("WebSocket closed"));
        this.pending.delete(id);
      }
      this.socket = undefined;
    };
  }

  private toWsUrl(baseUrl: string, path: string): string {
    const url = new URL(path, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
}
