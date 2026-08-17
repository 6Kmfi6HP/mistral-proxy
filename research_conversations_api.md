# Mistral Conversations API — Detailed Reference

> **Source**: OpenAPI 3.1.0 spec from `https://docs.mistral.ai/openapi.yaml` and the rendered API reference at `https://docs.mistral.ai/api/endpoint/beta/conversations`.
>
> **Status**: Beta — the API is under the `beta.conversations` namespace in both the Python and TypeScript SDKs.

---

## 1. Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/conversations` | List all created conversations |
| POST | `/v1/conversations` | Create a conversation and append entries (non-streaming) |
| POST | `/v1/conversations#stream` | Create a conversation and append entries (streaming SSE) |
| GET | `/v1/conversations/{conversation_id}` | Retrieve conversation metadata |
| POST | `/v1/conversations/{conversation_id}` | Append new entries to existing conversation (non-streaming) |
| POST | `/v1/conversations/{conversation_id}#stream` | Append new entries (streaming SSE) |
| DELETE | `/v1/conversations/{conversation_id}` | Delete a conversation |
| GET | `/v1/conversations/{conversation_id}/history` | Retrieve all entries |
| GET | `/v1/conversations/{conversation_id}/messages` | Retrieve all messages (filtered to message entries only) |
| POST | `/v1/conversations/{conversation_id}/restart` | Restart from a given entry (non-streaming) |
| POST | `/v1/conversations/{conversation_id}/restart#stream` | Restart from a given entry (streaming SSE) |

Streaming is controlled via two mechanisms:
- The `stream` boolean field in the request body.
- A separate URL fragment path (`#stream`) in the OpenAPI spec that defaults `stream` to `true` and constrains it to `enum: [true]`.

When `stream: false` (default for `POST /v1/conversations`), the response is a single JSON object (`ConversationResponse`).
When `stream: true` (default for `#stream` paths), the response is `text/event-stream` with `ConversationEvents` SSE messages.

---

## 2. POST /v1/conversations — Request Body Schema

**Schema**: `ConversationRequest` (extends `ConversationRequestBase`)

### Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `inputs` | `string \| InputEntry[]` | **Yes** | — | Either a plain string (shorthand for a single user message) or an array of entry objects. |
| `model` | `string \| null` | No | `null` | Model ID to use (e.g. `mistral-large-latest`). Required if `agent_id` is not provided. |
| `agent_id` | `string \| null` | No | `null` | ID of a Mistral Agent to use. |
| `agent_version` | `string \| integer \| null` | No | `null` | Specific agent version. |
| `instructions` | `string \| null` | No | `null` | System/instruction prompt the model follows during the conversation. |
| `tools` | `Tool[] \| null` | No | `null` | Array of tools available to the model. |
| `completion_args` | `CompletionArgs \| null` | No | `null` | White-listed completion API arguments. |
| `stream` | `boolean` | No | `false` (non-stream path) / `true` (stream path) | Whether to stream the response as SSE. |
| `store` | `boolean \| null` | No | `null` | Whether to persist the conversation server-side. |
| `name` | `string \| null` | No | `null` | Human-readable name for the conversation. |
| `description` | `string \| null` | No | `null` | Description of the conversation. |
| `metadata` | `MetadataDict \| null` | No | `null` | Custom metadata key-value pairs. |
| `guardrails` | `GuardrailConfig[] \| null` | No | `null` | Guardrail configurations. |
| `handoff_execution` | `"client" \| "server" \| null` | No | `null` | How agent handoffs are executed. |

> **Note**: When using the `#stream` path variant, `stream` is constrained to `enum: [true]` and defaults to `true`. When using the non-stream path, `stream` defaults to `false`.

---

## 3. Input Entry Types (`inputs` array)

The `inputs` field accepts either a plain string (shorthand for a single `message.input` with `role: "user"`) or an array of entries. Each entry has `object: "entry"` and a `type` discriminator. The following 6 entry types are accepted as inputs:

### 3.1 `message.input` — MessageInputEntry

User or assistant input message.

```json
{
  "object": "entry",
  "type": "message.input",
  "role": "user",            // "user" | "assistant"  (required)
  "content": "...",          // string or ContentChunk[] (required)
  "id": "...",               // string (optional, server-assigned)
  "created_at": "2025-01-01T00:00:00Z",  // date-time (optional, server-assigned)
  "completed_at": "2025-01-01T00:00:00Z", // date-time | null (optional)
  "prefix": false            // boolean (optional, default false)
}
```

**Content chunks** (`MessageInputContentChunks`): array of:
- `TextChunk` — `{ "type": "text", "text": "..." }`
- `ImageURLChunk` — `{ "type": "image_url", "image_url": "data:..." | { "url": "...", "detail": "low"|"auto"|"high" } }`
- `ToolFileChunk` — `{ "type": "tool_file", "tool": "web_search"|..., "file_id": "...", "file_name": "...", "file_type": "..." }`
- `DocumentURLChunk` — `{ "type": "document_url", "document_url": "...", "document_name": "..." }`
- `ThinkChunk` — `{ "type": "thinking", "thinking": [TextChunk|ToolReferenceChunk|ReferenceChunk, ...], "closed": true, "signature": "..." }`

### 3.2 `message.output` — MessageOutputEntry

Assistant output message (can be provided as context).

```json
{
  "object": "entry",
  "type": "message.output",
  "role": "assistant",       // always "assistant"
  "content": "...",          // string or ContentChunk[] (required)
  "id": "...",               // string (optional)
  "created_at": "...",       // date-time (optional)
  "completed_at": "...",     // date-time | null (optional)
  "agent_id": "...",         // string | null (optional)
  "model": "..."             // string | null (optional)
}
```

**Content chunks** (`MessageOutputContentChunks`): same as input, plus:
- `ToolReferenceChunk` — `{ "type": "tool_reference", "tool": "web_search"|..., "title": "...", "url": "...", "description": "...", "favicon": "..." }`

### 3.3 `function.call` — FunctionCallEntry

A function call requested by the model.

```json
{
  "object": "entry",
  "type": "function.call",
  "tool_call_id": "call_123",   // string (required)
  "name": "get_weather",        // string (required)
  "arguments": { "city": "Paris" }, // object | string (required)
  "id": "...",                  // string (optional)
  "created_at": "...",          // date-time (optional)
  "completed_at": "...",        // date-time | null (optional)
  "agent_id": "...",            // string | null (optional)
  "model": "...",               // string | null (optional)
  "confirmation_status": "pending"  // "pending" | "allowed" | "denied" | null (optional)
}
```

`arguments` can be either a JSON object (additionalProperties: true) or a string (e.g. JSON-encoded string).

### 3.4 `function.result` — FunctionResultEntry

The result of a function call, provided back to the conversation.

```json
{
  "object": "entry",
  "type": "function.result",
  "tool_call_id": "call_123",   // string (required)
  "result": "22°C, sunny",     // string (required)
  "id": "...",                 // string (optional)
  "created_at": "...",         // date-time (optional)
  "completed_at": "..."        // date-time | null (optional)
}
```

### 3.5 `tool.execution` — ToolExecutionEntry

Execution of a built-in tool/connector (e.g. web_search, code_interpreter).

```json
{
  "object": "entry",
  "type": "tool.execution",
  "name": "web_search",        // BuiltInConnectors | string (required)
  "arguments": "...",          // string (required)
  "info": { ... },            // ToolExecutionInfo object (optional)
  "id": "...",                 // string (optional)
  "created_at": "...",         // date-time (optional)
  "completed_at": "...",       // date-time | null (optional)
  "agent_id": "...",           // string | null (optional)
  "model": "..."               // string | null (optional)
}
```

`BuiltInConnectors` enum: `"web_search"`, `"web_search_premium"`, `"code_interpreter"`, `"image_generation"`, `"document_library"`.

`ToolExecutionInfo`: free-form object (`additionalProperties: true`).

### 3.6 `agent.handoff` — AgentHandoffEntry

Handoff from one agent to another.

```json
{
  "object": "entry",
  "type": "agent.handoff",
  "previous_agent_id": "agent_1",     // string (required)
  "previous_agent_name": "Agent One", // string (required)
  "next_agent_id": "agent_2",         // string (required)
  "next_agent_name": "Agent Two",     // string (required)
  "id": "...",                        // string (optional)
  "created_at": "...",                // date-time (optional)
  "completed_at": "..."              // date-time | null (optional)
}
```

---

## 4. Tools Array — Full Schema

The `tools` array accepts a discriminated union on the `type` field. Seven tool types are supported:

### 4.1 `function` — FunctionTool

Custom function tool.

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",           // string (required)
    "description": "Get weather",     // string (optional, default "")
    "parameters": {                  // object (required, additionalProperties: true)
      "type": "object",
      "properties": { ... },
      "required": [...]
    },
    "strict": false                  // boolean (optional, default false)
  }
}
```

### 4.2 `web_search` — WebSearchTool

Built-in web search.

```json
{
  "type": "web_search",
  "tool_configuration": {             // ToolConfiguration | null (optional)
    "include": ["..."],              // string[] | null
    "exclude": ["..."],              // string[] | null
    "requires_confirmation": ["..."] // string[] | null
  }
}
```

### 4.3 `web_search_premium` — WebSearchPremiumTool

Premium web search (same schema as `web_search` but type is `"web_search_premium"`).

### 4.4 `code_interpreter` — CodeInterpreterTool

Built-in code interpreter (same `ToolConfiguration` schema, type `"code_interpreter"`).

### 4.5 `image_generation` — ImageGenerationTool

Built-in image generation (same `ToolConfiguration` schema, type `"image_generation"`).

### 4.6 `document_library` — DocumentLibraryTool

Search across a document library.

```json
{
  "type": "document_library",
  "library_ids": ["lib_1"],          // string[] (required, minItems: 1)
  "tool_configuration": { ... }      // ToolConfiguration | null (optional)
}
```

### 4.7 `connector` — CustomConnector

Custom connector (integration with external services).

```json
{
  "type": "connector",
  "connector_id": "conn_123",         // string (required)
  "authorization": {                 // OAuth2TokenAuth | APIKeyAuth | null (optional)
    "type": "oauth2-token",          // or "api-key"
    "value": "..."                   // string (required)
  },
  "tool_configuration": { ... }      // ToolConfiguration | null (optional)
}
```

### ToolConfiguration

Shared configuration object for built-in tools:

```json
{
  "include": ["domain1.com"],         // string[] | null — domains/sources to include
  "exclude": ["domain2.com"],         // string[] | null — domains/sources to exclude
  "requires_confirmation": ["action"] // string[] | null — actions requiring confirmation
}
```

---

## 5. CompletionArgs

White-listed subset of the Chat Completion API parameters:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `temperature` | `number \| null` | `null` | 0–1. Controls randomness. |
| `top_p` | `number \| null` | `null` | 0–1. Nucleus sampling. |
| `max_tokens` | `integer \| null` | `null` | ≥0. Maximum tokens to generate. |
| `random_seed` | `integer \| null` | `null` | ≥0. For reproducibility. |
| `frequency_penalty` | `number \| null` | `null` | -2 to 2. |
| `presence_penalty` | `number \| null` | `null` | -2 to 2. |
| `stop` | `string \| string[] \| null` | — | Stop sequence(s). |
| `response_format` | `ResponseFormat \| null` | `null` | Output format. |
| `tool_choice` | `ToolChoiceEnum` | `"auto"` | `"auto"`, `"none"`, `"any"`, `"required"` |
| `prediction` | `Prediction \| null` | `null` | Expected completion for speculative decoding. |
| `reasoning_effort` | `ReasoningEffort \| null` | `null` | `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |

### ResponseFormat

```json
// Text mode (default)
{ "type": "text" }

// JSON mode
{ "type": "json_object" }

// JSON Schema mode
{
  "type": "json_schema",
  "json_schema": {
    "name": "Book",                    // string (required)
    "description": "...",              // string | null
    "schema": { ... },                 // object (required) — JSON Schema definition
    "strict": false                    // boolean (optional, default false)
  }
}
```

### Prediction

```json
{
  "type": "content",
  "content": "expected output..."
}
```

### ReasoningEffort

Enum: `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`

### ToolChoiceEnum

Enum: `"auto"`, `"none"`, `"any"`, `"required"`

---

## 6. Other Top-Level Fields

### `instructions`

Type: `string | null` (default `null`)

A system-level instruction prompt that the model follows during the conversation. This is stored on the `ModelConversation` entity and persists across turns. It functions similarly to the system prompt in the Chat API but is a conversation-level setting.

### `store`

Type: `boolean | null`

- For `POST /v1/conversations` (create): default `null` (creates a stored conversation).
- For `POST /v1/conversations/{conversation_id}` (append): default `true`.
- When `false`, the conversation entries are not persisted server-side.

### `handoff_execution`

Type: `"client" | "server" | null`

- `"server"` (default for append): The server automatically executes agent handoffs.
- `"client"`: The client must handle handoffs manually (the API returns the handoff entry and the client must re-invoke the target agent).

### `guardrails`

Type: `GuardrailConfig[] | null`

```json
[
  {
    "moderation_llm_v1": {
      "action": "block",              // "none" | "block"
      "model_name": "mistral-moderation-2411",  // default
      "custom_category_thresholds": { ... },     // nullable
      "ignore_other_categories": false
    },
    "moderation_llm_v2": {
      "action": "block",
      "model_name": "mistral-moderation-2603",
      "custom_category_thresholds": { ... },
      "ignore_other_categories": false
    },
    "block_on_error": false           // boolean — block request (HTTP 403) on server errors
  }
]
```

### `metadata`

Type: `MetadataDict | null` — free-form key-value object (`additionalProperties: true`).

### `tool_confirmations` (append endpoint only)

Type: `ToolCallConfirmation[] | null`

```json
[
  {
    "tool_call_id": "call_123",    // string (required)
    "confirmation": "allow"        // "allow" | "deny" (required)
  }
]
```

Used when a tool call requires confirmation — the client sends allow/deny decisions.

---

## 7. Non-Streaming Response Schema (`ConversationResponse`)

```json
{
  "conversation_id": "019b2bd7-...",     // string (required)
  "object": "conversation.response",    // const (required)
  "outputs": [ ... ],                   // OutputEntry[] (required)
  "usage": { ... },                     // ConversationUsageInfo (required)
  "guardrails": [ ... ] | null           // object[] | null (optional)
}
```

### 7.1 `outputs` array

The outputs array can contain 4 entry types (note: `message.input` and `function.result` are input-only types and never appear in outputs):

| Entry Type | When produced |
|-----------|---------------|
| `message.output` | Model generates a text/image/document response |
| `function.call` | Model requests to call a custom function tool |
| `tool.execution` | A built-in tool/connector is executed (e.g., web search, code interpreter) |
| `agent.handoff` | The model hands off to a different agent |

See sections 3.2–3.6 above for the full schema of each output entry type.

### 7.2 `usage` — ConversationUsageInfo

```json
{
  "prompt_tokens": 100,              // integer (default 0)
  "completion_tokens": 50,           // integer (default 0)
  "total_tokens": 150,               // integer (default 0)
  "connector_tokens": 200,           // integer | null (default null)
  "connectors": {                    // object<string, integer> | null (default null)
    "web_search": 150,
    "code_interpreter": 50
  }
}
```

- `prompt_tokens`: Tokens used for the prompt.
- `completion_tokens`: Tokens generated by the model.
- `total_tokens`: Sum of prompt + completion.
- `connector_tokens`: Total tokens consumed by built-in connectors/tools.
- `connectors`: Per-connector token breakdown.

### 7.3 `guardrails`

Array of free-form objects (`additionalProperties: true`) containing guardrail evaluation results. `null` if no guardrails were configured.

---

## 8. Conversation Entity Schemas (GET responses)

### 8.1 `ModelConversation`

Returned when the conversation uses a base model (not an agent):

```json
{
  "object": "conversation",
  "id": "019b2bd7-...",
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-01T10:30:00Z",
  "model": "mistral-small-latest",
  "name": "My Conversation",          // string | null
  "description": "...",              // string | null
  "instructions": "...",            // string | null
  "completion_args": { ... },        // CompletionArgs
  "tools": [ ... ],                  // Tool[]
  "guardrails": [ ... ],            // GuardrailConfig[] | null
  "metadata": { ... }               // MetadataDict | null
}
```

### 8.2 `AgentConversation`

Returned when the conversation uses a Mistral Agent:

```json
{
  "object": "conversation",
  "id": "019b2bd7-...",
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-01T10:30:00Z",
  "agent_id": "agent_123",
  "agent_version": "1",              // string | integer | null
  "name": "My Conversation",         // string | null
  "description": "...",             // string | null
  "metadata": { ... }               // MetadataDict | null
}
```

---

## 9. History & Messages Endpoints

### GET `/v1/conversations/{conversation_id}/history`

Returns all entries (messages, function calls, tool executions, handoffs):

```json
{
  "conversation_id": "...",
  "object": "conversation.history",
  "entries": [
    // MessageInputEntry | MessageOutputEntry | FunctionResultEntry | FunctionCallEntry | ToolExecutionEntry | AgentHandoffEntry
  ]
}
```

### GET `/v1/conversations/{conversation_id}/messages`

Returns only message entries (filters out function calls, tool executions, handoffs):

```json
{
  "conversation_id": "...",
  "object": "conversation.messages",
  "messages": [
    // MessageInputEntry | MessageOutputEntry
  ]
}
```

---

## 10. Streaming SSE Events

When `stream: true`, the response is `text/event-stream`. Each SSE event has:
- An `event:` field (the SSE type name)
- A `data:` field (the JSON payload, which has its own `type` matching the event name)

### 10.1 Event Type Summary

| SSE Event (`event:`) | Data `type` | Description |
|----------------------|-------------|-------------|
| `conversation.response.started` | `conversation.response.started` | Conversation processing has started; includes `conversation_id` |
| `conversation.response.done` | `conversation.response.done` | Conversation processing is complete; includes `usage` |
| `conversation.response.error` | `conversation.response.error` | An error occurred; includes `code` and `message` |
| `message.output.delta` | `message.output.delta` | Incremental assistant message content |
| `function.call.delta` | `function.call.delta` | Incremental function call data (arguments streaming) |
| `tool.execution.started` | `tool.execution.started` | A built-in tool execution has started |
| `tool.execution.delta` | `tool.execution.delta` | Incremental tool execution data |
| `tool.execution.done` | `tool.execution.done` | A built-in tool execution has completed |
| `agent.handoff.started` | `agent.handoff.started` | An agent handoff has started |
| `agent.handoff.done` | `agent.handoff.done` | An agent handoff has completed |

### 10.2 Event Payload Schemas

#### `conversation.response.started`

```json
{
  "type": "conversation.response.started",
  "conversation_id": "019b2bd7-...",  // string (required)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `conversation.response.done`

```json
{
  "type": "conversation.response.done",
  "usage": {                          // ConversationUsageInfo (required)
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "connector_tokens": null,
    "connectors": null
  },
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `conversation.response.error`

```json
{
  "type": "conversation.response.error",
  "code": 500,                        // integer (required)
  "message": "Internal error",        // string (required)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `message.output.delta`

Incremental assistant message. The `content_index` and `output_index` allow multiplexing multiple content parts and outputs.

```json
{
  "type": "message.output.delta",
  "id": "entry_123",                   // string (required)
  "role": "assistant",                 // const
  "content": "Hello",                 // string | OutputContentChunk (required)
  "output_index": 0,                  // integer (default 0)
  "content_index": 0,                 // integer (default 0)
  "agent_id": null,                   // string | null (default null)
  "model": null,                      // string | null (default null)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

`OutputContentChunk` can be any single chunk: `TextChunk`, `ImageURLChunk`, `ToolFileChunk`, `DocumentURLChunk`, `ThinkChunk`, or `ToolReferenceChunk`.

#### `function.call.delta`

Streaming function call arguments. The `arguments` field accumulates incrementally as a string.

```json
{
  "type": "function.call.delta",
  "id": "entry_456",                   // string (required)
  "tool_call_id": "call_789",         // string (required)
  "name": "get_weather",              // string (required)
  "arguments": "{\"city\":",           // string (required) — incremental JSON string
  "output_index": 0,                  // integer (default 0)
  "confirmation_status": null,        // "pending"|"allowed"|"denied"|null (default null)
  "agent_id": null,                   // string | null (default null)
  "model": null,                      // string | null (default null)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `tool.execution.started`

```json
{
  "type": "tool.execution.started",
  "id": "entry_789",                   // string (required)
  "name": "web_search",               // BuiltInConnectors | string (required)
  "arguments": "query",               // string (required)
  "output_index": 0,                  // integer (default 0)
  "agent_id": null,                   // string | null (default null)
  "model": null,                      // string | null (default null)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `tool.execution.delta`

```json
{
  "type": "tool.execution.delta",
  "id": "entry_789",                   // string (required)
  "name": "web_search",               // BuiltInConnectors | string (required)
  "arguments": "additional data",     // string (required)
  "output_index": 0,                  // integer (default 0)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `tool.execution.done`

```json
{
  "type": "tool.execution.done",
  "id": "entry_789",                   // string (required)
  "name": "web_search",               // BuiltInConnectors | string (required)
  "info": { "results": [...] },       // ToolExecutionInfo (optional) — free-form object
  "output_index": 0,                  // integer (default 0)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `agent.handoff.started`

```json
{
  "type": "agent.handoff.started",
  "id": "entry_abc",                  // string (required)
  "previous_agent_id": "agent_1",     // string (required)
  "previous_agent_name": "Agent One", // string (required)
  "output_index": 0,                  // integer (default 0)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

#### `agent.handoff.done`

```json
{
  "type": "agent.handoff.done",
  "id": "entry_abc",                  // string (required)
  "next_agent_id": "agent_2",         // string (required)
  "next_agent_name": "Agent Two",     // string (required)
  "output_index": 0,                  // integer (default 0)
  "created_at": "2025-01-01T10:00:00Z" // date-time (optional)
}
```

---

## 11. Content Chunk Types (Reference)

These chunk types appear inside `content` arrays for both input and output messages:

| Chunk Type | `type` value | Key Fields | Used In |
|-----------|-------------|------------|---------|
| `TextChunk` | `text` | `text: string` (required) | Input + Output |
| `ImageURLChunk` | `image_url` | `image_url: string \| ImageURL` (required) | Input + Output |
| `ToolFileChunk` | `tool_file` | `tool: string` (required), `file_id: string` (required), `file_name`, `file_type` | Input + Output |
| `DocumentURLChunk` | `document_url` | `document_url: string` (required), `document_name` | Input + Output |
| `ThinkChunk` | `thinking` | `thinking: (TextChunk\|ToolReferenceChunk\|ReferenceChunk)[]` (required), `closed: boolean` (default true), `signature: string\|null` | Input + Output |
| `ToolReferenceChunk` | `tool_reference` | `tool: string` (required), `title: string` (required), `url`, `description`, `favicon` | Output only |
| `ReferenceChunk` | `reference` | `reference_ids: (integer\|string)[]` (required) | Inside ThinkChunk only |

### ImageURL

```json
{
  "url": "data:image/png;base64,...",   // string (required)
  "detail": "auto"                       // "low" | "auto" | "high" (optional)
}
```

---

## 12. Append Endpoint — Additional Fields

### POST `/v1/conversations/{conversation_id}`

Request body (simpler than create — no `model`, `agent_id`, `instructions`, `tools`, `name`, `description`, `metadata`, `guardrails` at append time):

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `inputs` | `string \| InputEntry[]` | No* | — | New entries to append. |
| `completion_args` | `CompletionArgs \| null` | No | `null` | Override completion args for this turn. |
| `stream` | `boolean` | No | `false` | Streaming mode. |
| `store` | `boolean` | No | `true` | Whether to store results. |
| `handoff_execution` | `"client" \| "server"` | No | `"server"` | How handoffs are executed. |
| `tool_confirmations` | `ToolCallConfirmation[] \| null` | No | `null` | Confirmations for pending tool calls. |

> *`inputs` is not marked required for append (can be empty to just trigger a new completion).

---

## 13. Restart Endpoint

### POST `/v1/conversations/{conversation_id}/restart`

Creates a new conversation from a given entry in an existing conversation and runs completion.

Request body:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `from_entry_id` | `string` | **Yes** | — | Entry ID to restart from. |
| `inputs` | `string \| InputEntry[]` | No | — | New entries to append after restart point. |
| `completion_args` | `CompletionArgs \| null` | No | `null` | Completion parameters. |
| `agent_version` | `string \| integer \| null` | No | `null` | Agent version override. |
| `guardrails` | `GuardrailConfig[] \| null` | No | `null` | Guardrail configs. |
| `handoff_execution` | `"client" \| "server"` | No | `"server"` | Handoff execution mode. |
| `metadata` | `MetadataDict \| null` | No | `null` | Custom metadata for the new conversation. |
| `store` | `boolean` | No | `true` | Whether to store results. |
| `stream` | `boolean` | No | `false` | Streaming mode. |

Response: same `ConversationResponse` (or `ConversationEvents` stream).

---

## 14. Typical Event Flow

### Non-streaming flow

1. Client sends `POST /v1/conversations` with `inputs` and optional `model`/`tools`/`completion_args`.
2. Server processes: runs model completion, executes any built-in tools, handles function calls.
3. Server returns `ConversationResponse` with `conversation_id`, `outputs[]`, and `usage`.

### Streaming flow

1. Client sends `POST /v1/conversations#stream` (or sets `stream: true`).
2. Server emits events in order:
   - `conversation.response.started` — includes `conversation_id`
   - For each output (in order of `output_index`):
     - If **tool execution**: `tool.execution.started` → `tool.execution.delta` (zero or more) → `tool.execution.done`
     - If **function call**: `function.call.delta` (one or more, streaming the arguments string)
     - If **message output**: `message.output.delta` (one or more, streaming content; may have multiple `content_index` values)
     - If **agent handoff**: `agent.handoff.started` → `agent.handoff.done`
   - `conversation.response.done` — includes `usage`
   - On error: `conversation.response.error` — includes `code` and `message`

### Multi-turn conversation

1. First turn: `POST /v1/conversations` → get `conversation_id`.
2. Subsequent turns: `POST /v1/conversations/{conversation_id}` with new `inputs`.
3. The server maintains conversation history; you only send new entries.

### Function call flow (client-side execution)

1. Client sends request with `tools: [{"type": "function", "function": {...}}]`.
2. Server returns (or streams) a `function.call` entry in `outputs` with `tool_call_id`, `name`, `arguments`.
3. Client executes the function locally.
4. Client sends next request with `inputs: [{"type": "function.result", "tool_call_id": "...", "result": "..."}]`.
5. Server continues the conversation with the function result.

### Tool confirmation flow

1. A tool call is emitted with `confirmation_status: "pending"`.
2. Client sends `tool_confirmations: [{"tool_call_id": "...", "confirmation": "allow"|"deny"}]` in the next append request.
3. If allowed, the tool executes. If denied, the tool call is skipped.
