const required = (name: string, value: string | undefined): string => {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeSquareBaseUrl = (raw: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid TRIANGLE_SQUARE_BASE_URL: expected absolute URL, got "${raw}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Invalid TRIANGLE_SQUARE_BASE_URL: only http/https are supported, got "${parsed.protocol}"`
    );
  }

  const isLoopback = loopbackHosts.has(parsed.hostname.toLowerCase());
  if (!isLoopback && parsed.protocol === "http:" && parsed.port === "9000") {
    throw new Error(
      `Invalid TRIANGLE_SQUARE_BASE_URL: "${raw}" points to external host on :9000. ` +
        `Use the public HTTPS endpoint instead (for example: "https://${parsed.hostname}").`
    );
  }

  return parsed.toString().replace(/\/$/, "");
};

export const config = {
  port: Number(process.env.PORT ?? 9080),
  host: process.env.HOST?.trim() || "0.0.0.0",
  squareBaseUrl: normalizeSquareBaseUrl(
    required("TRIANGLE_SQUARE_BASE_URL", process.env.TRIANGLE_SQUARE_BASE_URL)
  ),
  squareApiKey: required("TRIANGLE_SQUARE_API_KEY", process.env.TRIANGLE_SQUARE_API_KEY),
  useApiKeyTarget: process.env.TRIANGLE_USE_API_KEY_TARGET?.trim().toLowerCase() !== "false",
  defaultRecipientAgentId: process.env.TRIANGLE_DEFAULT_RECIPIENT_AGENT_ID?.trim() || "",
  transportOrder: (process.env.TRIANGLE_SQUARE_TRANSPORTS ?? "a2a_stream,a2a_http,proxy_http")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
};

export type SquareTransport = "a2a_stream" | "a2a_http" | "proxy_http";

export function parseTransportOrder(raw: string[]): SquareTransport[] {
  const allowed: SquareTransport[] = ["a2a_stream", "a2a_http", "proxy_http"];
  const parsed = raw.filter((item): item is SquareTransport => allowed.includes(item as SquareTransport));
  return parsed.length > 0 ? parsed : ["a2a_stream", "a2a_http", "proxy_http"];
}
