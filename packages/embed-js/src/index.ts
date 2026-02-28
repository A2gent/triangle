import { TriangleClient, type TriangleAttachment } from "@triangle/sdk-core";

export interface TriangleWidgetConfig {
  baseUrl: string;
  recipientAgentId: string;
  mount: HTMLElement;
  title?: string;
}

interface AgentMeta {
  id: string;
  name: string;
  avatarUrl?: string;
}

async function fileToAttachment(file: File): Promise<TriangleAttachment> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const dataBase64 = btoa(binary);
  const mediaType = file.type || "application/octet-stream";
  return {
    type: mediaType.startsWith("audio/") ? "audio" : "image",
    name: file.name,
    mediaType,
    dataBase64
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createTriangleWidget(cfg: TriangleWidgetConfig) {
  const client = new TriangleClient({
    baseUrl: cfg.baseUrl,
    transport: "auto",
    defaultRecipientAgentId: cfg.recipientAgentId
  });

  let conversationId: string | undefined;

  cfg.mount.innerHTML = `
    <div style="font-family: ui-sans-serif, system-ui; width: 100%; border: 1px solid #d4d4d8; border-radius: 14px; overflow: hidden; background: #fff;">
      <div style="padding: 10px 14px; background: #111827; color: #fff; display:flex; align-items:center; gap:10px;">
        <img data-role="agent-avatar" alt="Agent avatar" style="display:none;width:30px;height:30px;border-radius:50%;object-fit:cover;background:#1f2937;border:1px solid rgba(255,255,255,0.15);" />
        <div data-role="agent-title" style="font-weight:700;line-height:1.1;">${escapeHtml(cfg.title ?? "Chat with agent")}</div>
      </div>
      <div data-role="messages" style="display:none; max-height:320px; overflow:hidden; padding:0; background:transparent;"></div>
      <div style="padding: 10px; border-top: 1px solid #e4e4e7;">
        <div style="display:flex; align-items:flex-end; gap:8px;">
          <textarea data-role="input" rows="1" placeholder="Type a message..." style="flex:1; min-height:44px; max-height:120px; resize:vertical; border:1px solid #d4d4d8; border-radius:10px; padding:10px 12px; text-align:right; font-family:inherit; font-size:14px; line-height:1.4;"></textarea>
          <input data-role="files" type="file" multiple accept="image/*,audio/*" style="display:none;" />
          <button data-role="file-pick" type="button" title="Attach files" style="width:42px;height:42px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#1d4ed8;">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M7 10.5l4.8-4.8a2.7 2.7 0 0 1 3.9 3.8l-6.2 6.2a4.4 4.4 0 1 1-6.2-6.2l6.5-6.5" />
            </svg>
          </button>
          <button data-role="send" type="button" style="height:42px;background:#2563eb;color:white;border:none;border-radius:10px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
              <polygon points="4,3 17,10 4,17" fill="#93c5fd"></polygon>
            </svg>
            <span>Send</span>
          </button>
        </div>
        <div data-role="file-meta" style="font-size:12px;color:#64748b;margin-top:6px;min-height:1em;"></div>
      </div>
    </div>
  `;

  const messages = cfg.mount.querySelector("[data-role=messages]") as HTMLDivElement;
  const agentTitle = cfg.mount.querySelector("[data-role=agent-title]") as HTMLDivElement;
  const agentAvatar = cfg.mount.querySelector("[data-role=agent-avatar]") as HTMLImageElement;
  const input = cfg.mount.querySelector("[data-role=input]") as HTMLTextAreaElement;
  const files = cfg.mount.querySelector("[data-role=files]") as HTMLInputElement;
  const filePick = cfg.mount.querySelector("[data-role=file-pick]") as HTMLButtonElement;
  const fileMeta = cfg.mount.querySelector("[data-role=file-meta]") as HTMLDivElement;
  const sendBtn = cfg.mount.querySelector("[data-role=send]") as HTMLButtonElement;
  const sendLabel = sendBtn.querySelector("span") as HTMLSpanElement | null;
  let pendingAssistantNode: HTMLDivElement | null = null;

  const updateMessagesVisibility = () => {
    const hasMessages = messages.childElementCount > 0;
    if (hasMessages) {
      messages.style.display = "block";
      messages.style.maxHeight = "320px";
      messages.style.overflow = "auto";
      messages.style.padding = "12px";
      messages.style.background = "#f6f8fb";
      return;
    }
    messages.style.display = "none";
    messages.style.maxHeight = "320px";
    messages.style.overflow = "hidden";
    messages.style.padding = "0";
    messages.style.background = "transparent";
  };

  const appendMessage = (role: string, text: string, attachments?: TriangleAttachment[]) => {
    const isUser = role === "You";
    const container = document.createElement("div");
    container.style.marginBottom = "10px";
    container.style.display = "flex";
    container.style.justifyContent = isUser ? "flex-end" : "flex-start";

    const frame = document.createElement("div");
    frame.style.maxWidth = "76%";
    frame.style.display = "grid";
    frame.style.gap = "4px";

    const roleLabel = document.createElement("div");
    roleLabel.style.fontSize = "12px";
    roleLabel.style.color = "#52525b";
    roleLabel.style.textAlign = isUser ? "right" : "left";
    roleLabel.textContent = role;

    const bubble = document.createElement("div");
    bubble.style.borderRadius = "10px";
    bubble.style.padding = "9px 11px";
    bubble.style.whiteSpace = "pre-wrap";
    bubble.style.textAlign = isUser ? "right" : "left";
    bubble.style.background = isUser ? "#2563eb" : "#ffffff";
    bubble.style.color = isUser ? "#ffffff" : "#0f172a";
    bubble.style.border = isUser ? "none" : "1px solid #e4e4e7";
    bubble.textContent = text || "";

    frame.appendChild(roleLabel);
    frame.appendChild(bubble);

    if (attachments?.length) {
      const mediaWrap = document.createElement("div");
      mediaWrap.style.display = "grid";
      mediaWrap.style.gap = "6px";
      mediaWrap.style.marginTop = "6px";
      for (const a of attachments) {
        if (a.type === "image") {
          const src = a.url ?? `data:${a.mediaType ?? "image/png"};base64,${a.dataBase64 ?? ""}`;
          const img = document.createElement("img");
          img.src = src;
          img.style.maxWidth = "280px";
          img.style.borderRadius = "6px";
          mediaWrap.appendChild(img);
        } else if (a.type === "audio") {
          const src = a.url ?? `data:${a.mediaType ?? "audio/mpeg"};base64,${a.dataBase64 ?? ""}`;
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.src = src;
          mediaWrap.appendChild(audio);
        }
      }
      frame.appendChild(mediaWrap);
    }
    container.appendChild(frame);
    messages.appendChild(container);
    updateMessagesVisibility();
    messages.scrollTop = messages.scrollHeight;
  };

  const updateFileMeta = () => {
    const count = files.files?.length ?? 0;
    fileMeta.textContent = count > 0 ? `${count} file${count > 1 ? "s" : ""} selected` : "";
  };

  const setBusy = (busy: boolean) => {
    sendBtn.disabled = busy;
    filePick.disabled = busy;
    input.disabled = busy;
    if (sendLabel) {
      sendLabel.textContent = busy ? "Sending..." : "Send";
    }
  };

  const showPendingAssistant = () => {
    if (pendingAssistantNode) {
      return;
    }
    const wrap = document.createElement("div");
    wrap.style.marginBottom = "10px";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "flex-start";

    const frame = document.createElement("div");
    frame.style.maxWidth = "76%";
    frame.style.display = "grid";
    frame.style.gap = "4px";

    const roleLabel = document.createElement("div");
    roleLabel.style.fontSize = "12px";
    roleLabel.style.color = "#52525b";
    roleLabel.textContent = "Assistant";

    const bubble = document.createElement("div");
    bubble.style.borderRadius = "10px";
    bubble.style.padding = "9px 11px";
    bubble.style.background = "#ffffff";
    bubble.style.color = "#64748b";
    bubble.style.border = "1px solid #e4e4e7";
    bubble.textContent = "Thinking...";

    frame.appendChild(roleLabel);
    frame.appendChild(bubble);
    wrap.appendChild(frame);
    messages.appendChild(wrap);
    updateMessagesVisibility();
    messages.scrollTop = messages.scrollHeight;
    pendingAssistantNode = wrap;
  };

  const hidePendingAssistant = () => {
    if (!pendingAssistantNode) {
      return;
    }
    pendingAssistantNode.remove();
    pendingAssistantNode = null;
    updateMessagesVisibility();
  };

  const setAgentMeta = (meta: AgentMeta) => {
    if (meta.name?.trim()) {
      agentTitle.textContent = meta.name.trim();
    }
    if (meta.avatarUrl?.trim()) {
      agentAvatar.src = meta.avatarUrl.trim();
      agentAvatar.style.display = "block";
    } else {
      agentAvatar.removeAttribute("src");
      agentAvatar.style.display = "none";
    }
  };

  const loadAgentMeta = async () => {
    try {
      const base = cfg.baseUrl.replace(/\/$/, "");
      const qp = cfg.recipientAgentId?.trim()
        ? `?recipientAgentId=${encodeURIComponent(cfg.recipientAgentId.trim())}`
        : "";
      const resp = await fetch(`${base}/v1/chat/agent${qp}`);
      if (!resp.ok) {
        return;
      }
      const meta = (await resp.json()) as AgentMeta;
      if (!meta || typeof meta !== "object") {
        return;
      }
      setAgentMeta(meta);
    } catch {
      // Ignore metadata failures; chat should still work.
    }
  };

  const onSend = async () => {
    const messageText = input.value;
    const selected = Array.from(files.files ?? []);
    if (!messageText.trim() && selected.length === 0) {
      return;
    }

    setBusy(true);
    try {
      const attachments: TriangleAttachment[] = [];
      for (const file of selected) {
        attachments.push(await fileToAttachment(file));
      }

      appendMessage("You", messageText, attachments);
      showPendingAssistant();

      const result = await client.sendMessage({
        conversationId,
        text: messageText,
        attachments
      });
      hidePendingAssistant();
      conversationId = result.conversationId ?? conversationId;
      for (const msg of result.messages.filter((m) => m.role === "assistant")) {
        appendMessage("Assistant", msg.text ?? "", msg.attachments);
      }

      input.value = "";
      files.value = "";
      updateFileMeta();
    } catch (err) {
      hidePendingAssistant();
      appendMessage("System", `Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  filePick.addEventListener("click", () => files.click());
  files.addEventListener("change", updateFileMeta);
  sendBtn.addEventListener("click", () => void onSend());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  });
  updateMessagesVisibility();
  void loadAgentMeta();

  return {
    destroy: () => {
      client.close();
      cfg.mount.innerHTML = "";
    }
  };
}
