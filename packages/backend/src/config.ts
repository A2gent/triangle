const required = (name: string, value: string | undefined): string => {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

export const config = {
  port: Number(process.env.PORT ?? 9080),
  host: process.env.HOST?.trim() || "0.0.0.0",
  squareBaseUrl: required("TRIANGLE_SQUARE_BASE_URL", process.env.TRIANGLE_SQUARE_BASE_URL),
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
