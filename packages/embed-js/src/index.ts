import { TriangleClient, type TriangleAttachment } from "@triangle/sdk-core";

export interface TriangleWidgetConfig {
  baseUrl: string;
  recipientAgentId: string;
  mount: HTMLElement;
  title?: string;
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
    <div style="font-family: ui-sans-serif, system-ui; width: 100%; max-width: 420px; border: 1px solid #d4d4d8; border-radius: 12px; overflow: hidden; background: #fff;">
      <div style="padding: 10px 12px; background: #111827; color: #fff; font-weight: 600;">${escapeHtml(cfg.title ?? "Triangle Chat")}</div>
      <div data-role="messages" style="height: 320px; overflow: auto; padding: 12px; background: #fafafa;"></div>
      <div style="padding: 10px; border-top: 1px solid #e4e4e7; display: grid; gap: 8px;">
        <textarea data-role="input" rows="3" placeholder="Type a message..." style="width: 100%; resize: vertical; border: 1px solid #d4d4d8; border-radius: 8px; padding: 8px;"></textarea>
        <input data-role="files" type="file" multiple accept="image/*,audio/*" />
        <button data-role="send" style="background: #0f766e; color: white; border: none; border-radius: 8px; padding: 8px 10px; cursor: pointer;">Send</button>
      </div>
    </div>
  `;

  const messages = cfg.mount.querySelector("[data-role=messages]") as HTMLDivElement;
  const input = cfg.mount.querySelector("[data-role=input]") as HTMLTextAreaElement;
  const files = cfg.mount.querySelector("[data-role=files]") as HTMLInputElement;
  const sendBtn = cfg.mount.querySelector("[data-role=send]") as HTMLButtonElement;

  const appendMessage = (role: string, text: string, attachments?: TriangleAttachment[]) => {
    const container = document.createElement("div");
    container.style.marginBottom = "10px";
    container.innerHTML = `<div style="font-size:12px;color:#52525b;margin-bottom:2px;">${escapeHtml(role)}</div><div style="background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:8px;white-space:pre-wrap;">${escapeHtml(text || "")}</div>`;
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
          img.style.maxWidth = "220px";
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
      container.appendChild(mediaWrap);
    }
    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;
  };

  const onSend = async () => {
    sendBtn.disabled = true;
    try {
      const attachments: TriangleAttachment[] = [];
      const selected = Array.from(files.files ?? []);
      for (const file of selected) {
        attachments.push(await fileToAttachment(file));
      }

      appendMessage("You", input.value, attachments);

      const result = await client.sendMessage({
        conversationId,
        text: input.value,
        attachments
      });
      conversationId = result.conversationId ?? conversationId;
      for (const msg of result.messages.filter((m) => m.role === "assistant")) {
        appendMessage("Assistant", msg.text ?? "", msg.attachments);
      }

      input.value = "";
      files.value = "";
    } catch (err) {
      appendMessage("System", `Error: ${(err as Error).message}`);
    } finally {
      sendBtn.disabled = false;
    }
  };

  sendBtn.addEventListener("click", () => void onSend());

  return {
    destroy: () => {
      client.close();
      cfg.mount.innerHTML = "";
    }
  };
}
