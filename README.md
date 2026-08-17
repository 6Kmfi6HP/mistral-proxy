# Mistral Proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Cloudflare Worker that translates OpenAI-format `/v1/chat/completions` requests into Mistral `/v1/conversations` API calls, then translates the responses back to OpenAI format.

Cloudflare Worker 代理，将 OpenAI 格式的 `/v1/chat/completions` 请求翻译成 Mistral `/v1/conversations` 格式转发，再把响应翻译回 OpenAI 格式返回。

---

## Background | 背景

**EN:** Mistral's `/v1/chat/completions` endpoint has strict rate limits (~4 requests per short window → 429). The `/v1/conversations` endpoint has no such rate limit (but higher latency, 4–12s). This Worker routes through the conversations API while maintaining an OpenAI-compatible interface.

**中文：** Mistral 的 `/v1/chat/completions` 端点有严格限流（短窗口约 4 次即 429），而 `/v1/conversations` 端点不限流（但延迟较高，4-12s）。此 Worker 绕过限流，同时保持 OpenAI 兼容的接口格式。

## Features | 功能

- **`POST /v1/chat/completions`** — Chat completions (streaming, function calling, multimodal content, built-in tools)
- **`GET /v1/models`** — Model list (OpenAI-compatible passthrough)
- **`GET /v1/models/{model_id}`** — Model details (passthrough)
- **`POST /v1/embeddings`** — Embeddings (passthrough)
- **`GET /` `/health`** — Health check
- **CORS support** — Automatic CORS headers + preflight
- **API Key passthrough** — Client sends `Authorization: Bearer <key>`, Worker forwards it

## Request Translation (OpenAI → Mistral Conversations)

| OpenAI | Mistral | Notes |
|--------|---------|-------|
| `messages` | `inputs` | Structural translation, role constrained |
| `role: "system"` | top-level `instructions` | Conversations endpoint rejects system role |
| `temperature` etc. | `completion_args.*` | Sampling params must be nested |
| `stream: true` | top-level `stream` | Must be a top-level field |
| `response_format` | `completion_args.response_format` | JSON mode passthrough |
| `random_seed` / `seed` | `completion_args.random_seed` | Seed passthrough |
| `tool_choice` | `completion_args.tool_choice` | `required` → `required`, `auto`/`none` passthrough |
| `reasoning_effort` | `completion_args.reasoning_effort` | Reasoning depth passthrough |
| `prediction` | `completion_args.prediction` | Prediction output passthrough |
| `tools` (function) | `tools` (FunctionTool) | Compatible format, direct passthrough |
| `tools` (web_search etc.) | `tools` (WebSearchTool etc.) | Built-in tool translation |
| assistant `tool_calls` | standalone `function.call` entry | Split into individual entries |
| `role: "tool"` | `function.result` entry | Field rename: `content` → `result` |
| multimodal content | content chunks | Translate to Mistral content chunks |
| `prefix` (assistant) | `prefix` | Prefix completion support |
| `store` | `store` | Persist conversation |
| `metadata` | `metadata` | Metadata passthrough |
| `agent_id` / `agent_version` | `agent_id` / `agent_version` | Agent support |

## Response Translation (Mistral → OpenAI)

| Mistral | OpenAI | Notes |
|---------|--------|-------|
| `outputs[]` | `choices[].message` | message.output → content |
| `function.call` entry | `choices[].message.tool_calls` | Independent entries to array |
| `tool.execution` entry | text content | Built-in tool results formatted as text |
| `agent.handoff` entry | ignored/text notification | Agent handoff doesn't block response |
| `conversation.response.done` | `finish_reason: "stop"` | Usage passthrough |
| SSE event stream | SSE chunk stream | Per-event translation |

## Deploy | 部署

```bash
cd mistral-proxy

# Install dependencies
npm install

# Deploy (requires Cloudflare API Token + Account ID)
CLOUDFLARE_API_TOKEN="YOUR_CF_API_TOKEN" \
CLOUDFLARE_ACCOUNT_ID="YOUR_CF_ACCOUNT_ID" \
npm run deploy
```

After deployment: `https://mistral-proxy.<your-subdomain>.workers.dev`

## Usage | 用法

```bash
# Non-streaming
curl https://mistral-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MISTRAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral-large-latest",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming
curl -N https://mistral-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MISTRAL_KEY" \
  -d '{
    "model": "mistral-large-latest",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Function Calling
curl https://mistral-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MISTRAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral-large-latest",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{"type": "function", "function": {"name": "get_weather", "description": "Get weather", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}]
  }'

# JSON Mode
curl https://mistral-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MISTRAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral-large-latest",
    "messages": [{"role": "user", "content": "Return a JSON object with name and age"}],
    "response_format": {"type": "json_object"}
  }'

# List models
curl https://mistral-proxy.<your-subdomain>.workers.dev/v1/models \
  -H "Authorization: Bearer YOUR_MISTRAL_KEY"
```

## Limitations | 限制

- Conversations endpoint has higher latency (4–12s), not suitable for low-latency scenarios
- OpenAI `n` parameter (multiple choices) not supported — Conversations API returns a single result
- OpenAI `logprobs` not supported
- `tool_choice` in object format (specific function) not supported, falls back to `auto`
- Audio input (`input_audio`) not yet supported

## References | 参考文档

- [Mistral Conversations API](https://docs.mistral.ai/api/endpoint/beta/conversations)
- [Mistral Models API](https://docs.mistral.ai/api/endpoint/models)
- [Mistral Function Calling](https://docs.mistral.ai/studio/conversations/function-calling)
- [Mistral OpenAPI Spec](https://docs.mistral.ai/openapi.yaml)
- [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/general/)

## License

[MIT](LICENSE)
