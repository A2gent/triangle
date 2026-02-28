import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { z } from "zod";
import crypto from "node:crypto";

import { config, parseTransportOrder } from "./config.js";
import { SquareClient } from "./square-client.js";
import { fromSquareResponse, toSquareA2AMessage } from "./transform.js";
import type { ChatMessageInput } from "./types.js";

const attachmentSchema = z.object({
  type: z.enum(["image", "audio"]),
  name: z.string().optional(),
  mediaType: z.string().optional(),
  dataBase64: z.string().optional(),
  url: z.string().optional()
});

const chatMessageSchema = z.object({
  conversationId: z.string().optional(),
  recipientAgentId: z.string().optional(),
  text: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  metadata: z.record(z.unknown()).optional()
});

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST"]
});

await app.register(websocket);

const squareClient = new SquareClient({
  baseUrl: config.squareBaseUrl,
  apiKey: config.squareApiKey,
  transports: parseTransportOrder(config.transportOrder)
});

async function resolveRecipientAgentId(input: ChatMessageInput): Promise<string> {
  const requested = (input.recipientAgentId ?? "").trim();
  const configured = config.defaultRecipientAgentId.trim();
  const configuredOrRequested = requested || configured;

  if (config.useApiKeyTarget) {
    let keyTargetAgentId = "";
    try {
      keyTargetAgentId = (await squareClient.getAuthenticatedAgentID()).trim();
    } catch (err) {
      if (configuredOrRequested) {
        app.log.warn(
          {
            err,
            configuredOrRequested
          },
          "failed to resolve target from API key, falling back to configured/requested recipient"
        );
        return configuredOrRequested;
      }
      throw err;
    }
    if (!keyTargetAgentId) {
      throw new Error("could not resolve target agent from API key");
    }

    // Integration keys (sqi_) are bound to one target agent in Square.
    if (squareClient.apiKeyPrefix === "sqi_") {
      if (configuredOrRequested && configuredOrRequested !== keyTargetAgentId) {
        app.log.warn(
          {
            configuredOrRequested,
            keyTargetAgentId
          },
          "recipientAgentId ignored because integration API key is bound to a different target"
        );
      }
      return keyTargetAgentId;
    }

    // For normal sq_ agent keys, explicit/configured recipient remains primary.
    if (configuredOrRequested) {
      return configuredOrRequested;
    }
    return keyTargetAgentId;
  }

  if (configuredOrRequested) {
    return configuredOrRequested;
  }
  throw new Error("recipientAgentId is required");
}

async function handleInboundMessage(input: ChatMessageInput) {
  const recipientAgentId = await resolveRecipientAgentId(input);

  const canonical = toSquareA2AMessage(input, recipientAgentId);
  const squareResponse = await squareClient.sendMessage(canonical);
  const response = fromSquareResponse(squareResponse);

  const userMessage = {
    id: canonical.message_id ?? crypto.randomUUID(),
    role: "user" as const,
    text: input.text?.trim() || "",
    attachments: input.attachments ?? [],
    createdAt: new Date().toISOString()
  };

  response.messages = [userMessage, ...response.messages];
  response.conversationId = response.conversationId ?? input.conversationId;
  return response;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/v1/chat/agent", async (request, reply) => {
  const query = request.query as { recipientAgentId?: string };
  const requested = (query?.recipientAgentId ?? "").trim();
  try {
    if (!requested) {
      const profile = await squareClient.getAuthenticatedAgentProfile();
      return reply.send(profile);
    }

    try {
      const profile = await squareClient.getAgentProfile(requested);
      return reply.send(profile);
    } catch (err) {
      request.log.warn({ err, requested }, "requested agent lookup failed, falling back to authenticated agent");
      const fallback = await squareClient.getAuthenticatedAgentProfile();
      return reply.send(fallback);
    }
  } catch (err) {
    request.log.error({ err, requested }, "agent metadata lookup failed");
    return reply.code(502).send({ error: (err as Error).message });
  }
});

app.post("/v1/chat/message", async (request, reply) => {
  const parsed = chatMessageSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid payload", issues: parsed.error.issues });
  }

  try {
    const response = await handleInboundMessage(parsed.data);
    return reply.send(response);
  } catch (err) {
    request.log.error({ err }, "chat message failed");
    return reply.code(502).send({ error: (err as Error).message });
  }
});

app.get("/v1/chat/ws", { websocket: true }, (socket) => {
  socket.on("message", async (raw: Buffer) => {
    let envelope: any;
    try {
      envelope = JSON.parse(String(raw));
    } catch {
      socket.send(JSON.stringify({ type: "server.error", error: "invalid JSON" }));
      return;
    }

    if (envelope?.type !== "client.message" || !envelope?.payload) {
      socket.send(JSON.stringify({ type: "server.error", error: "unsupported envelope" }));
      return;
    }

    const parsed = chatMessageSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      socket.send(
        JSON.stringify({
          type: "server.response",
          requestId: envelope.requestId,
          error: "invalid payload"
        })
      );
      return;
    }

    try {
      const response = await handleInboundMessage(parsed.data);
      socket.send(
        JSON.stringify({
          type: "server.response",
          requestId: envelope.requestId,
          payload: response
        })
      );
    } catch (err) {
      socket.send(
        JSON.stringify({
          type: "server.response",
          requestId: envelope.requestId,
          error: (err as Error).message
        })
      );
    }
  });
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`triangle backend listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
