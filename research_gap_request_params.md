# Research: Mistral Conversations API Request Parameters vs OpenAI Chat Completions API

**Source**: Mistral OpenAPI spec at `https://docs.mistral.ai/openapi.yaml` (OpenAPI 3.1.0)
**Date**: 2025-01-XX

---

## 1. ALL CompletionArgs Fields (Conversations API)

The `CompletionArgs` schema (used inside `ConversationRequestBase.completion_args`) supports exactly **11 fields**:

| Field | Type | Constraints | Default |
|---|---|---|---|
| `temperature` | number \| null | min 0, max 1 | — |
| `top_p` | number \| null | min 0, max 1 | — |
| `max_tokens` | integer \| null | min 0 | — |
| `random_seed` | integer \| null | min 0 | — |
| `frequency_penalty` | number \| null | min -2, max 2 | — |
| `presence_penalty` | number \| null | min -2, max 2 | — |
| `stop` | string \| string[] \| null | — | — |
| `response_format` | ResponseFormat \| null | `{type: text\|json_object\|json_schema, json_schema?: JsonSchema}` | — |
| `tool_choice` | ToolChoiceEnum (string) | enum: `auto`, `none`, `any`, `required` | `"auto"` |
| `prediction` | Prediction \| null | `{type: "content", content: string}` | — |
| `reasoning_effort` | ReasoningEffort \| null | enum: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | — |

**`additionalProperties: false`** — no other fields are accepted.

### Key observations:
- `tool_choice` is **string-only** (ToolChoiceEnum). No object form.
- `parallel_tool_calls` is **NOT** present.
- `n` is **NOT** present.
- No `user`, `logprobs`, `top_logprobs`, `logit_bias`, `modalities`, `audio`, `service_tier`, `stream_options`.

---

## 2. Does the Conversations API support `parallel_tool_calls`?

**No.** The `CompletionArgs` schema does not include `parallel_tool_calls`. The field is not listed anywhere in the Conversations API request schemas.

For comparison, Mistral's own **Chat Completions API** (`ChatCompletionRequest`) DOES support `parallel_tool_calls` (boolean, default `true`), but this was deliberately excluded from the Conversations API's `CompletionArgs`.

---

## 3. Does the Conversations API support `tool_choice` as an object?

**No.** In `CompletionArgs`, `tool_choice` references only `ToolChoiceEnum`:

```
ToolChoiceEnum = "auto" | "none" | "any" | "required"
```

There is no `anyOf` union with an object schema. You **cannot** specify `{"type": "function", "function": {"name": "my_func"}}` through the Conversations API.

For comparison, Mistral's Chat Completions API (`ChatCompletionRequest`) supports **both**:
- `ToolChoiceEnum` (string): `auto`, `none`, `any`, `required`
- `ToolChoice` (object): `{"type": "function", "function": {"name": "..."}}`

OpenAI's Chat Completions API also supports both string and object forms.

---

## 4. Valid values for `reasoning_effort`

### Mistral Conversations API (`ReasoningEffort`):
```
none | minimal | low | medium | high | xhigh
```
(6 values)

### Mistral Chat Completions API:
Same 6 values: `none | minimal | low | medium | high | xhigh`

### OpenAI Chat Completions API:
```
none | minimal | low | medium | high | xhigh | max
```
(7 values — includes `max`, which Mistral does not support)

---

## 5. OpenAI Params Support in Conversations API

| OpenAI Param | Mistral Conversations API? | Mistral Chat Completions API? | Notes |
|---|---|---|---|
| `user` | ❌ No | ❌ No | Neither Mistral API supports `user` |
| `n` | ❌ No | ✅ Yes | Chat Completions supports `n` (integer, min 1) |
| `logprobs` | ❌ No | ❌ No | Neither Mistral API supports `logprobs` |
| `top_logprobs` | ❌ No | ❌ No | Neither Mistral API supports `top_logprobs` |
| `logit_bias` | ❌ No | ❌ No | Neither Mistral API supports `logit_bias` |
| `modalities` | ❌ No | ❌ No | Neither Mistral API supports `modalities` |
| `audio` | ❌ No | ❌ No | Neither Mistral API supports `audio` |
| `service_tier` | ❌ No | ✅ Yes | Chat Completions supports `service_tier` (RequestedServiceTier) |
| `stream_options` | ❌ No | ❌ No | Neither Mistral API supports `stream_options` |
| `parallel_tool_calls` | ❌ No | ✅ Yes | Chat Completions supports `parallel_tool_calls` (boolean, default true) |
| `seed` | ❌ No (uses `random_seed`) | ❌ No (uses `random_seed`) | Mistral uses `random_seed` instead of OpenAI's `seed` |
| `max_completion_tokens` | ❌ No (uses `max_tokens`) | ❌ No (uses `max_tokens`) | Mistral uses `max_tokens` instead of OpenAI's `max_completion_tokens` |
| `store` | ✅ Yes (top-level) | ✅ Yes | Both support `store` but at different levels |
| `prediction` | ✅ Yes | ✅ Yes | Both Mistral APIs support `prediction` |
| `reasoning_effort` | ✅ Yes | ✅ Yes | Both Mistral APIs support `reasoning_effort` |
| `response_format` | ✅ Yes | ✅ Yes | Both Mistral APIs support `response_format` |
| `safe_prompt` | ❌ No | ✅ Yes | Chat Completions supports `safe_prompt` (boolean, default false) |
| `prompt_cache_key` | ❌ No | ✅ Yes | Chat Completions supports `prompt_cache_key` |
| `prompt_mode` | ❌ No | ✅ Yes | Chat Completions supports `prompt_mode` |

### OpenAI-only params with NO Mistral equivalent anywhere:
- `user`
- `logprobs`
- `top_logprobs`
- `logit_bias`
- `modalities`
- `audio`
- `stream_options`
- `web_search_options`
- `verbosity`
- `function_call` (deprecated)
- `functions` (deprecated)

---

## 6. Full List of ConversationRequestBase Fields

The `ConversationRequestBase` (extended by `ConversationRequest` for non-streaming and `ConversationStreamRequest` for streaming) has these top-level fields:

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `inputs` | string \| InputEntries | ✅ Yes | — | The conversation input (string or array of entries) |
| `stream` | boolean \| null | No | `null` | Whether to stream (overridden to false/true in sub-schemas) |
| `store` | boolean \| null | No | `null` | Whether to store the conversation on Mistral's servers |
| `handoff_execution` | "client" \| "server" \| null | No | `null` | How agent handoffs are executed |
| `instructions` | string \| null | No | `null` | System-level instructions for the conversation |
| `tools` | array of tool definitions \| null | No | `null` | Available tools (function, web_search, web_search_premium, code_interpreter, image_generation, document_library, connector) |
| `completion_args` | CompletionArgs \| null | No | `null` | Completion parameters (temperature, top_p, etc.) |
| `guardrails` | array of GuardrailConfig \| null | No | `null` | Content moderation guardrails |
| `name` | string \| null | No | `null` | Conversation name |
| `description` | string \| null | No | `null` | Conversation description |
| `metadata` | MetadataDict \| null | No | `null` | Custom metadata (free-form key-value object) |
| `agent_id` | string \| null | No | `null` | Agent ID to use |
| `agent_version` | string \| integer \| null | No | `null` | Specific agent version |
| `model` | string \| null | No | `null` | Model ID |

**`additionalProperties` is not set to false on ConversationRequestBase** (it's implicitly allowed), but the sub-schemas (`ConversationRequest`, `ConversationStreamRequest`) use `allOf` composition.

### Sub-schemas:
- **`ConversationRequest`** (non-streaming): `ConversationRequestBase` + `stream: false`
- **`ConversationStreamRequest`** (streaming): `ConversationRequestBase` + `stream: true`

### Append/Restart request variants:
- **`AppendConversationRequest`**: `inputs`, `stream`, `store` (default true), `handoff_execution` (default "server"), `completion_args`, `tool_confirmations`
- **`RestartConversationRequest`**: `inputs`, `stream`, `store` (default true), `handoff_execution` (default "server"), `completion_args`, `guardrails`, `metadata`, `from_entry_id` (required), `agent_version`

---

## Summary: Key Gaps Between Mistral Conversations API and OpenAI Chat Completions API

### Params in OpenAI but NOT in Mistral Conversations API:
1. `parallel_tool_calls` — not in CompletionArgs
2. `tool_choice` as object — only string enum allowed
3. `n` — not supported
4. `user` — not supported
5. `logprobs` — not supported
6. `top_logprobs` — not supported
7. `logit_bias` — not supported
8. `modalities` — not supported
9. `audio` — not supported
10. `service_tier` — not supported
11. `stream_options` — not supported
12. `seed` — Mistral uses `random_seed` instead
13. `max_completion_tokens` — Mistral uses `max_tokens` instead
14. `reasoning_effort: "max"` — Mistral doesn't support this value (OpenAI does)
15. `web_search_options` — not supported (Mistral uses web_search as a tool type instead)
16. `verbosity` — not supported
17. `prompt_cache_options` — not supported

### Params in Mistral Conversations API but NOT in OpenAI Chat Completions:
1. `handoff_execution` — Mistral-specific (client/server)
2. `instructions` — Mistral-specific (system-level instructions as a top-level field)
3. `guardrails` — Mistral-specific content moderation
4. `agent_id` / `agent_version` — Mistral agent system
5. `name` / `description` — conversation metadata
6. `store` at top-level (OpenAI also has `store` but at the same level)

### Naming differences:
| OpenAI | Mistral Conversations |
|---|---|
| `seed` | `random_seed` |
| `max_completion_tokens` | `max_tokens` |
| `tool_choice` (string + object) | `tool_choice` (string enum only) |
| `reasoning_effort` includes `max` | `reasoning_effort` excludes `max` |
