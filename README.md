# Triangle

Triangle is an embeddable chat service for websites that proxies conversations to `square` and ultimately to remote agents (for your setup, `brute`).

## What is implemented

- Backend (`@triangle/backend`)
- Accepts frontend chat over HTTP (`POST /v1/chat/message`) and WebSocket (`GET /v1/chat/ws`).
- Proxies to Square using API key with transport fallback order:
  - `a2a_stream` (`/a2a/messages/send/stream`)
  - `a2a_http` (`/a2a/messages/send`)
  - `proxy_http` (`/proxy/request`)
- Supports multiple image and audio attachments from frontend.
- Converts messages into canonical A2A `content[]` for Square/Brute compatibility.
- Resolves target agent from Square API key via `GET /agents/me` (especially for `sqi_...` integration keys bound to one target agent).

- Frontend SDK (`@triangle/sdk-core`)
- Browser client with WS-first and HTTP fallback.

- Embeddable libraries
- `@triangle/embed-js`: plain JS/HTML widget.
- `@triangle/embed-react`: React component.

## Compatibility findings

- `square` canonical A2A currently supports `content[].type` values:
  - `text`
  - `image_url`
  - `image_base64`
- `brute` A2A inbound currently consumes canonical text + image parts and legacy image fields.
- Audio is not yet a canonical A2A content type in current `square`/`brute` bridge code.

Triangle behavior for audio right now:

- Audio attachments are accepted from frontend.
- Audio is preserved under `metadata.triangle.media.audio` for forward compatibility.
- Canonical `content[]` remains valid (`text`/`image_*`) so Square accepts the request.

## Run backend

```bash
cd /Users/artjom/git/a2gent/triangle
cp .env.example .env
npm install
set -a; source .env; set +a
npm run dev:backend
```

### Square base URL

- Local development Square: `TRIANGLE_SQUARE_BASE_URL=http://localhost:9000`
- Production Square behind nginx/TLS: `TRIANGLE_SQUARE_BASE_URL=https://a2gent.net`
- Do not use external `http://<host>:9000` for production traffic.

### API key targeting behavior

- `sqi_...` integration key:
  - Triangle resolves the bound target agent from `/agents/me`.
  - Any provided `recipientAgentId` is ignored if it conflicts with the key target.
- `sq_...` agent key:
  - Triangle uses `recipientAgentId` from request or `TRIANGLE_DEFAULT_RECIPIENT_AGENT_ID`.
  - If neither is set and `TRIANGLE_USE_API_KEY_TARGET=true`, it falls back to `/agents/me`.

## Build all packages

```bash
cd /Users/artjom/git/a2gent/triangle
npm install
npm run build
```

## Embed examples

### Plain JS

```ts
import { createTriangleWidget } from "@triangle/embed-js";

createTriangleWidget({
  baseUrl: "http://localhost:9080",
  recipientAgentId: "<target-agent-id>",
  mount: document.getElementById("widget")!
});
```

### React

```tsx
import { TriangleChat } from "@triangle/embed-react";

<TriangleChat
  baseUrl="http://localhost:9080"
  recipientAgentId="<target-agent-id>"
  title="Website Assistant"
/>
```

## Next compatibility step for full audio agent handling

Implement an A2A extension in both `square` and `brute` to allow canonical `content` types like `audio_url` / `audio_base64` and map them through `NormalizeA2APayload` + `a2atunnel` handlers.
