import { useMemo, useState } from "react";
import { TriangleClient, type TriangleAttachment, type TriangleMessage } from "@triangle/sdk-core";

export interface TriangleChatProps {
  baseUrl: string;
  recipientAgentId: string;
  title?: string;
}

async function toAttachment(file: File): Promise<TriangleAttachment> {
  const raw = await file.arrayBuffer();
  const bytes = new Uint8Array(raw);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return {
    type: file.type.startsWith("audio/") ? "audio" : "image",
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    dataBase64: btoa(binary)
  };
}

export function TriangleChat(props: TriangleChatProps) {
  const client = useMemo(
    () =>
      new TriangleClient({
        baseUrl: props.baseUrl,
        defaultRecipientAgentId: props.recipientAgentId,
        transport: "auto"
      }),
    [props.baseUrl, props.recipientAgentId]
  );

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<TriangleMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const attachments: TriangleAttachment[] = [];
      for (const f of files) {
        attachments.push(await toAttachment(f));
      }

      const userMessage: TriangleMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        attachments,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, userMessage]);

      const res = await client.sendMessage({ conversationId, text, attachments });
      if (res.conversationId) {
        setConversationId(res.conversationId);
      }
      setMessages((prev) => [...prev, ...res.messages.filter((m) => m.role === "assistant")]);
      setText("");
      setFiles([]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: (err as Error).message,
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: "1px solid #d4d4d8", borderRadius: 12, overflow: "hidden", background: "#fff", maxWidth: 520 }}>
      <div style={{ padding: "10px 12px", background: "#0f172a", color: "#fff", fontWeight: 600 }}>{props.title ?? "Triangle Chat"}</div>
      <div style={{ padding: 12, height: 360, overflowY: "auto", background: "#fafafa" }}>
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          const roleLabel = isUser ? "You" : isSystem ? "System" : "Assistant";

          return (
            <div key={m.id} style={{ marginBottom: 10, display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "80%", display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, color: isSystem ? "#9f1239" : "#52525b", marginBottom: 2, textAlign: isUser ? "right" : "left" }}>{roleLabel}</div>
                <div
                  style={{
                    background: isUser ? "#2563eb" : isSystem ? "#fff1f2" : "#fff",
                    color: isUser ? "#fff" : isSystem ? "#9f1239" : "#0f172a",
                    border: isUser ? "none" : isSystem ? "1px solid #fecdd3" : "1px solid #e4e4e7",
                    borderRadius: 8,
                    padding: 8,
                    whiteSpace: "pre-wrap"
                  }}
                >
                  {m.text}
                </div>
                {!!m.attachments?.length && (
                  <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                    {m.attachments.map((a, i) =>
                      a.type === "image" ? (
                        <img
                          key={i}
                          src={a.url ?? `data:${a.mediaType ?? "image/png"};base64,${a.dataBase64 ?? ""}`}
                          alt={a.name ?? "image"}
                          style={{ maxWidth: 260, borderRadius: 8 }}
                        />
                      ) : (
                        <audio
                          key={i}
                          controls
                          src={a.url ?? `data:${a.mediaType ?? "audio/mpeg"};base64,${a.dataBase64 ?? ""}`}
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 8, padding: 10, borderTop: "1px solid #e4e4e7" }}>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." />
        <input
          type="file"
          multiple
          accept="image/*,audio/*"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <button onClick={() => void send()} disabled={busy}>
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
