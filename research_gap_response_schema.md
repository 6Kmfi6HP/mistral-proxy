# Mistral Conversations API Response Schema — Gap Analysis vs OpenAI Chat Completions

> Source: Mistral OpenAPI spec (`https://docs.mistral.ai/openapi.yaml`), Mistral docs
> (`https://docs.mistral.ai/`), and the existing `worker.js` proxy implementation.

---

## 1. ConversationResponse — Full Schema

The `ConversationResponse` (returned by `POST /v1/conversations` and
`POST /v1/conversations/{conversation_id}`) contains:

```jsonc
{
  "object": "conversation.response",     // const, always "conversation.response"
  "conversation_id": "string",            // required — UUID of the conversation
  "outputs": [                            // required — array of output entries
    // MessageOutputEntry | ToolExecutionEntry | FunctionCallEntry | AgentHandoffEntry
  ],
  "usage": { ... },                        // required — ConversationUsageInfo
  "guardrails": [ ... ] | null             // optional, default null
}
```

**Required fields:** `conversation_id`, `outputs`, `usage`
**Optional fields:** `object` (defaults to `"conversation.response"`), `guardrails` (defaults to `null`)

### Comparison with OpenAI Chat Completions response

| OpenAI field          | Mistral ConversationResponse equivalent       | Notes |
|-----------------------|-----------------------------------------------|-------|
| `id`                  | `conversation_id`                             | Mistral uses conversation UUID, not a chat completion ID |
| `object`              | `object`                                      | OpenAI: `"chat.completion"`; Mistral: `"conversation.response"` |
| `created`             | (derived from `outputs[*].created_at`)        | Mistral has no top-level `created`; must extract from first output entry's `created_at` |
| `model`               | (derived from `outputs[*].model`)              | Mistral has no top-level `model`; must extract from first output entry that has `model` |
| `choices`             | `outputs`                                     | Must be mapped/translated; see sections below |
| `usage`               | `usage`                                       | Different shape; see §3 |
| `system_fingerprint`  | **none**                                      | Not present in Mistral Conversations API |
| —                     | `guardrails`                                   | No OpenAI equivalent; see §7 |

**Current worker.js behavior:** The proxy already maps `conversation_id` → `id`,
extracts `model` and `created_at` from outputs, and maps `usage` to OpenAI's 3-field
format. It does NOT include `system_fingerprint` (correct, since Mistral doesn't provide one).

---

## 2. Output Entry Types

The `outputs` array can contain exactly **four** entry types, identified by their `type` field:

### 2a. `message.output` — MessageOutputEntry

```jsonc
{
  "object": "entry",
  "type": "message.output",
  "id": "msg_xxx",
  "role": "assistant",                      // const
  "created_at": "2025-04-10T17:16:23Z",
  "completed_at": "2025-04-10T17:16:30Z",   // or null
  "agent_id": "ag_xxx",                     // or null
  "model": "mistral-medium-latest",         // or null
  "content": "string" | [ ContentChunks ]   // see §5, §8 for chunk types
}
```

`content` can be a plain string **or** an array of content chunks:
- `TextChunk` (`{ type: "text", text: "..." }`)
- `ThinkChunk` (`{ type: "thinking", thinking: [TextChunk|ToolReferenceChunk|ReferenceChunk], signature?: string|null, closed?: bool }`)
- `ToolReferenceChunk` (`{ type: "tool_reference", tool, title, url?, favicon?, description? }`)
- `ToolFileChunk` (`{ type: "tool_file", tool, file_id, file_name?, file_type? }`)
- `ImageURLChunk` (`{ type: "image_url", image_url: "..." | ImageURL }`)
- `DocumentURLChunk` (`{ type: "document_url", document_url: "...", document_name?: string }`)

### 2b. `function.call` — FunctionCallEntry

```jsonc
{
  "object": "entry",
  "type": "function.call",
  "id": "fcall_xxx",
  "tool_call_id": "string",                  // required
  "name": "string",                          // required — function name
  "arguments": object | string,              // required — can be object or string
  "created_at": "...",
  "completed_at": "..." | null,
  "agent_id": "ag_xxx" | null,
  "model": "mistral-medium-latest" | null,
  "confirmation_status": "pending" | "allowed" | "denied" | null
}
```

**Maps to OpenAI:** `tool_calls[].id` = `tool_call_id`, `tool_calls[].function.name` = `name`,
`tool_calls[].function.arguments` = stringified `arguments`. The `confirmation_status`
field has no OpenAI equivalent.

### 2c. `tool.execution` — ToolExecutionEntry

```jsonc
{
  "object": "entry",
  "type": "tool.execution",
  "id": "tool_exec_xxx",
  "name": "web_search" | "code_interpreter" | "image_generation" | "document_library" | "web_search_premium" | "string",
  "arguments": "string",                    // JSON string of arguments
  "info": { ... },                           // ToolExecutionInfo — free-form object
  "created_at": "...",
  "completed_at": "..." | null,
  "agent_id": "ag_xxx" | null,
  "model": "mistral-medium-latest" | null
}
```

`name` can be any of the `BuiltInConnectors` enum (`web_search`, `web_search_premium`,
`code_interpreter`, `image_generation`, `document_library`) or a custom string for
custom connectors. `info` is a free-form object (`additionalProperties: true`) — the
shape depends on the tool type. The OpenAPI spec does NOT define the `info` sub-schema
beyond `ToolExecutionInfo` = `{ type: object, additionalProperties: true }`.

**Maps to OpenAI:** No direct equivalent. The current proxy converts these to text
content in the assistant message. OpenAI's chat completions API doesn't have
"built-in tool execution" entries — tools are always `function` type with separate
request/response cycles. The proxy's current approach of converting tool execution
results to readable text is a reasonable mapping.

### 2d. `agent.handoff` — AgentHandoffEntry

```jsonc
{
  "object": "entry",
  "type": "agent.handoff",
  "id": "handoff_xxx",
  "previous_agent_id": "string",            // required
  "previous_agent_name": "string",          // required
  "next_agent_id": "string",                 // required
  "next_agent_name": "string",              // required
  "created_at": "...",
  "completed_at": "..." | null
}
```

Note: `AgentHandoffEntry` has NO `model`, `agent_id`, `name`, or `arguments` fields.
It is purely a routing notification between agents.

**Maps to OpenAI:** No direct equivalent. OpenAI has no multi-agent handoff concept.
See §4 for translation recommendations.

---

## 3. Usage Object — ConversationUsageInfo

```jsonc
{
  "prompt_tokens": 0,           // int, default 0
  "completion_tokens": 0,       // int, default 0
  "total_tokens": 0,            // int, default 0
  "connector_tokens": null,     // int | null, default null
  "connectors": null            // { [connectorName: string]: int } | null, default null
}
```

**Yes, it has `connector_tokens` and `connectors` breakdown:**

- `connector_tokens` (int | null): Total tokens consumed by built-in connectors
  (web_search, code_interpreter, etc.). Only present when connectors were used.
- `connectors` (object | null): Per-connector token breakdown, e.g.
  `{"web_search": 150, "code_interpreter": 200}`. Only present when connectors were used.

### Comparison with OpenAI UsageInfo

| OpenAI field           | Mistral ConversationUsageInfo field |
|------------------------|--------------------------------------|
| `prompt_tokens`        | `prompt_tokens`                       |
| `completion_tokens`    | `completion_tokens`                   |
| `total_tokens`         | `total_tokens`                        |
| —                      | `connector_tokens` (no OpenAI equivalent) |
| —                      | `connectors` (no OpenAI equivalent)   |

Mistral's Chat Completions `UsageInfo` (separate from Conversation API) has
`prompt_audio_seconds` and `service_tier` fields, but the Conversations API
`ConversationUsageInfo` does NOT have those.

**Current worker.js behavior:** Only maps `prompt_tokens`, `completion_tokens`,
`total_tokens`. Drops `connector_tokens` and `connectors`.

**Recommendation:** The proxy could optionally include `connector_tokens` and
`connectors` as extra fields in the OpenAI response's `usage` object for
completeness, though strict OpenAI clients would ignore them. Alternatively, they
could be omitted to maintain strict OpenAI compatibility.

---

## 4. Agent Handoff Translation (Non-Streaming Response)

**Problem:** The current `translateResponse()` function collects `agentHandoffs`
but **does nothing with them** — they are filtered into a variable that is never
used:

```js
const agentHandoffs = outputs.filter((o) => o.type === 'agent.handoff');
// ... agentHandoffs is never referenced again
```

### Translation Recommendations

Since OpenAI has no concept of agent handoffs, there are several options:

**Option A (recommended): Append as metadata/system content in the assistant message**
- Prepend or append a human-readable note to the message content:
  `[Handed off from {previous_agent_name} to {next_agent_name}]`
- This is consistent with what the streaming path already does (lines 694-720).

**Option B: Add as custom field on the response**
- Include `"handoffs": [...]` as an extra field on the response object, alongside
  the standard OpenAI fields. Non-OpenAI-aware clients would ignore it.

**Option C: Use a system message via the `choices` array**
- If there are only handoffs and no message output, return a message with the
  handoff info as text content.

**Recommended implementation for `translateResponse()`:**

```js
// After collecting agentHandoffs, append as readable text
for (const ho of agentHandoffs) {
  toolResultParts.push(`[Handed off from ${ho.previous_agent_name} to ${ho.next_agent_name}]`);
}
```

This is minimal and consistent with the streaming behavior.

---

## 5. ToolReferenceChunk Translation to OpenAI Format

### Mistral ToolReferenceChunk Schema

```jsonc
{
  "type": "tool_reference",       // const
  "tool": "web_search" | string,  // required — BuiltInConnectors or custom string
  "title": "string",              // required — display title (e.g. source title)
  "url": "string" | null,         // optional — source URL
  "favicon": "string" | null,     // optional — favicon URL
  "description": "string" | null   // optional — description
}
```

This chunk appears inside `MessageOutputEntry.content[]` arrays alongside `TextChunk`s.
It represents a citation/reference to a tool result — for example, a web search result
that the model is referencing in its text response.

### OpenAI Equivalent

OpenAI's chat completions API supports `annotations` on message content parts (since
the structured content format). The closest equivalent is:

```jsonc
{
  "type": "text",
  "text": "The interest rate is 4.50%",
  "annotations": [
    {
      "type": "url_citation",
      "url": "https://tradingeconomics.com/united-states/interest-rate",
      "title": "United States Fed Funds Interest Rate",
      "start_index": 0,
      "end_index": 28
    }
  ]
}
```

However, OpenAI's annotations require character indices (`start_index`/`end_index`)
into the text, which Mistral doesn't provide. Mistral's `ToolReferenceChunk` is a
separate content item interleaved with text, not an annotation on text.

### Recommended Translation

**Non-streaming (`translateResponse`):**
- Currently: `extractText()` returns `part.text || ''` for non-text chunks, so
  `ToolReferenceChunk` is silently dropped (it has no `text` field).
- **Fix:** Convert to inline markdown citation: `[title](url)` or `[title]` if no URL.

**Streaming:**
- Currently: `contentText += \`[${chunk.title || chunk.tool}]\``
- This is reasonable but could be improved to include URL as markdown link.

### ReferenceChunk (separate from ToolReferenceChunk)

There is also a `ReferenceChunk` (`{ type: "reference", reference_ids: [int|string] }`),
which appears inside `ThinkChunk.thinking[]`. This represents references to documents
provided as function call results. OpenAI has no equivalent — these could be dropped
or converted to inline text.

---

## 6. Model Fingerprint / System Fingerprint

**Mistral Conversations API: No fingerprint fields.**

There are zero mentions of "fingerprint", "system_fingerprint", or any similar field
in the entire Mistral OpenAPI spec. The `ConversationResponse` schema has no
fingerprint field, nor do any of the output entry schemas.

**Mistral's Chat Completions API** (`ChatCompletionResponse` / `ResponseBase`) also
has no `system_fingerprint` field.

OpenAI introduced `system_fingerprint` to track backend configuration changes. Mistral
does not provide this. The proxy should NOT include a `system_fingerprint` field in
its response (or could set it to `null` if strict OpenAI clients require the field
to exist).

**Current worker.js behavior:** Does not include `system_fingerprint`. ✅ Correct.

---

## 7. Guardrails in the Response

### Schema

The `guardrails` field in `ConversationResponse` is:

```jsonc
"guardrails": [
  { ... free-form object ... }
] | null
```

It is `array<object, additionalProperties: true> | null`, defaulting to `null`.
The OpenAPI spec does not define a structured schema for individual guardrail result
objects — they are free-form. This likely contains moderation results when
guardrails are configured on the request (via `GuardrailConfig`).

### Request-side Guardrails

The request `GuardrailConfig` supports:
- `block_on_error` (bool, default false): block request on server-side error
- `moderation_llm_v1`: `ModerationLLMV1Config` (legacy, `mistral-moderation-2411`)
- `moderation_llm_v2`: `ModerationLLMV2Config` (current, `mistral-moderation-2603`)

When a guardrail triggers, the API returns HTTP 403 and blocks the request. The
`guardrails` field in the response likely contains moderation evaluation results
when guardrails are configured but not triggered (i.e., the request passed
moderation).

### OpenAI Equivalent

OpenAI has no guardrails field in chat completions responses.

### Recommendation

- If `guardrails` is non-null in the Mistral response, it could be:
  - **Dropped** (current behavior) — simplest and maintains strict OpenAI compatibility.
  - **Added as a custom field** — e.g., `"x-mistral-guardrails": [...]` for clients
    that want the information.
- If a guardrail triggers (HTTP 403), the proxy should return an appropriate
  OpenAI-style error response.

---

## 8. ToolFileChunk Translation

### Schema

```jsonc
{
  "type": "tool_file",            // const
  "tool": "code_interpreter" | "image_generation" | string,  // required
  "file_id": "string",            // required — Mistral file ID
  "file_name": "string" | null,   // optional
  "file_type": "string" | null    // optional
}
```

This chunk appears inside `MessageOutputEntry.content[]` and represents a file
produced by a tool (e.g., a code interpreter output file or a generated image).

### OpenAI Equivalent

OpenAI's chat completions API (with `gpt-4o`) supports image content in responses:
```jsonc
{
  "type": "image_url",
  "image_url": { "url": "..." }
}
```

For files, OpenAI has file annotations:
```jsonc
{
  "type": "file",
  "file": { "id": "file-xxx", "filename": "output.png" }
}
```

But OpenAI's Chat Completions API doesn't natively return file outputs in the
assistant message content the way Mistral does — this is more of an Assistants API
concept.

### Current Worker Behavior

`extractText()` returns `part.text || ''` for ToolFileChunk — since it has no
`text` field, it is **silently dropped**. The streaming path also doesn't handle it.

### Recommendation

**Non-streaming:** Convert to a text reference:
```js
if (part.type === 'tool_file') {
  return `[File: ${part.file_name || part.file_id} (${part.tool})]`;
}
```

Or, if the file is an image and the client supports it, convert to an `image_url`
content part with the Mistral file download URL.

**Streaming:** Emit a content delta with the text representation.

---

## 9. Finish Reason / Stop Reason Equivalents

### Mistral Conversations API: No explicit finish_reason

The `ConversationResponse` schema has **no** `finish_reason`, `stop_reason`, or
equivalent field. The response simply contains the `outputs` array and `usage`.

Mistral's Chat Completions API *does* have `finish_reason` in `ChatCompletionChoice`:
```jsonc
"finish_reason": "stop" | "length" | "model_length" | "error" | "tool_calls"
```

But the Conversations API does not provide this information at all.

### Translation Strategy

The proxy must **infer** `finish_reason` from the outputs:

| Condition | Inferred `finish_reason` |
|-----------|--------------------------|
| `function.call` entries present | `"tool_calls"` |
| No `function.call`, outputs contain messages | `"stop"` |
| No outputs / empty | `"stop"` (or `"error"`) |
| Response truncated (no way to detect) | Cannot be determined — default to `"stop"` |

**Current worker.js behavior:**
```js
let finishReason = 'stop';
if (functionCalls.length > 0) finishReason = 'tool_calls';
if (toolExecutions.length > 0 && functionCalls.length === 0) finishReason = 'stop';
```
This is correct for the available information. `"length"` cannot be reliably detected
from the Conversations API response.

---

## 10. Content Index in Streaming `message.output.delta`

### MessageOutputEvent Schema (streaming)

```jsonc
{
  "type": "message.output.delta",     // const
  "created_at": "2025-04-10T17:16:23Z",
  "output_index": 0,                  // int, default 0 — which output entry this delta belongs to
  "content_index": 0,                 // int, default 0 — which content part within the output entry
  "id": "msg_xxx",
  "model": "mistral-medium-latest" | null,
  "agent_id": "ag_xxx" | null,
  "role": "assistant",
  "content": "string" | OutputContentChunks  // the delta content
}
```

### How `content_index` Works

- **`output_index`**: Identifies which output entry in the `outputs` array this
  delta corresponds to. For simple conversations, this is always 0. For multi-agent
  workflows with handoffs, there may be multiple `message.output` entries with
  different indices.

- **`content_index`**: Identifies which content part within a single
  `MessageOutputEntry.content[]` array this delta belongs to. When the model
  produces multi-part content (e.g., text → tool_reference → text), each part gets
  its own `content_index`. This allows the client to reconstruct the full content
  array by accumulating deltas at the same `content_index`.

### Translation to OpenAI Streaming

OpenAI's streaming format uses `choices[].index` to identify the choice (always 0
for non-n streaming) and `delta` for the content. There is no `content_index`
equivalent — OpenAI streams content as a simple string in `delta.content`.

**Current worker.js behavior:**
```js
choices: [{ index: data.output_index ?? 0, delta: { content: contentText }, finish_reason: null }]
```
This maps `output_index` → `choices[].index`, which is correct for single-choice
responses. The `content_index` is currently ignored, which means multi-part content
from the same output entry is concatenated into a single text stream. This is
acceptable for the OpenAI text streaming format but loses the structured part
boundaries (e.g., where a tool_reference starts/ends within the text).

**Recommendation:** For the streaming case, `content_index` can be safely ignored
since OpenAI streaming doesn't support multi-part content in deltas. The current
approach of concatenating all text from different content_index values is correct
for the OpenAI format.

---

## Summary of Gaps in Current `worker.js`

| # | Gap | Severity | Section |
|---|-----|----------|---------|
| 1 | `agent.handoff` entries ignored in `translateResponse()` | Medium | §4 |
| 2 | `ToolReferenceChunk` silently dropped in `extractText()` | Medium | §5 |
| 3 | `ToolFileChunk` silently dropped in `extractText()` | Medium | §8 |
| 4 | `connector_tokens` and `connectors` usage fields dropped | Low | §3 |
| 5 | No `system_fingerprint` (correct — Mistral doesn't provide one) | N/A | §6 |
| 6 | `guardrails` response field dropped (acceptable) | Low | §7 |
| 7 | `finish_reason` inferred from outputs (no direct field available) | N/A | §9 |
| 8 | `content_index` ignored in streaming (acceptable for OpenAI format) | Low | §10 |
| 9 | `ThinkChunk` handling in `extractText()` returns empty string — `ToolReferenceChunk` and `ReferenceChunk` inside thinking are dropped | Low | §5 |
| 10 | `ImageURLChunk` and `DocumentURLChunk` in output content dropped by `extractText()` | Medium | §8 |

### Missing from `extractText()` — all non-text chunks dropped

The current `extractText()` function:
```js
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.type === 'thinking') return '';  // thinking handled separately
      return part.text || '';  // ← drops tool_reference, tool_file, image_url, document_url
    })
    .filter(Boolean)
    .join('');
}
```

**Fix recommendation for `extractText()`:**

```js
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.type === 'thinking') return '';
      if (part.type === 'text') return part.text || '';
      if (part.type === 'tool_reference') {
        const title = part.title || part.tool;
        return part.url ? `[${title}](${part.url})` : `[${title}]`;
      }
      if (part.type === 'tool_file') {
        return `[File: ${part.file_name || part.file_id}]`;
      }
      if (part.type === 'image_url') {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url || '';
        return url ? `![image](${url})` : '[image]';
      }
      if (part.type === 'document_url') {
        return `[Document: ${part.document_name || part.document_url}]`;
      }
      return part.text || '';
    })
    .filter(Boolean)
    .join('');
}
```

---

## Appendix: All SSE Event Types (Streaming)

The Conversations API streaming uses these SSE event types:

| Event type | Data schema | Description |
|------------|-------------|-------------|
| `conversation.response.started` | `ResponseStartedEvent` | Conversation started, contains `conversation_id` |
| `conversation.response.done` | `ResponseDoneEvent` | Conversation completed, contains `usage` |
| `conversation.response.error` | `ResponseErrorEvent` | Error occurred, contains `message` and `code` |
| `message.output.delta` | `MessageOutputEvent` | Content delta, contains `output_index`, `content_index`, `content` |
| `tool.execution.started` | `ToolExecutionStartedEvent` | Tool started, contains `name`, `arguments`, `id` |
| `tool.execution.delta` | `ToolExecutionDeltaEvent` | Tool execution progress, contains `arguments` (partial) |
| `tool.execution.done` | `ToolExecutionDoneEvent` | Tool completed, contains `info` |
| `function.call.delta` | `FunctionCallEvent` | Function call delta, contains `name`, `arguments`, `tool_call_id` |
| `agent.handoff.started` | `AgentHandoffStartedEvent` | Handoff started, contains `previous_agent_id`, `previous_agent_name` |
| `agent.handoff.done` | `AgentHandoffDoneEvent` | Handoff completed, contains `next_agent_id`, `next_agent_name` |
