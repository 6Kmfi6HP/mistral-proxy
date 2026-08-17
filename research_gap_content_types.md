# Mistral Conversations API Content Chunk Types vs OpenAI Chat Completions

## Sources
- Mistral OpenAPI spec: https://docs.mistral.ai/openapi.yaml
- Conversations API endpoint ref: https://docs.mistral.ai/api/endpoint/beta/conversations
- Chat Completions doc: https://docs.mistral.ai/studio/conversations/chat-completion
- Vision doc: https://docs.mistral.ai/studio/conversations/vision
- Reasoning doc: https://docs.mistral.ai/studio/conversations/reasoning
- Citations & References doc: https://docs.mistral.ai/studio/conversations/citations
- Audio doc: https://docs.mistral.ai/studio/audio/overview

---

## Summary Table: Content Chunk Types Across Mistral APIs

| Chunk Type | `type` value | Chat Completions (ContentChunk) | Conversations Input (MessageInputContentChunks) | Conversations Output (MessageOutputContentChunks) |
|---|---|---|---|---|
| **TextChunk** | `"text"` | ✅ | ✅ | ✅ |
| **ImageURLChunk** | `"image_url"` | ✅ | ✅ | ✅ |
| **DocumentURLChunk** | `"document_url"` | ✅ | ✅ | ✅ |
| **ThinkChunk** | `"thinking"` | ✅ | ✅ | ✅ |
| **AudioChunk** | `"input_audio"` | ✅ | ❌ | ❌ |
| **ReferenceChunk** | `"reference"` | ✅ | ❌ | ❌ |
| **FileChunk** | `"file"` | ✅ | ❌ | ❌ |
| **ToolFileChunk** | `"tool_file"` | ❌ | ✅ | ✅ |
| **ToolReferenceChunk** | `"tool_reference"` | ❌ | ❌ | ✅ (output only) |

### Key Observation: Conversations API vs Chat Completions API

The **Conversations API** (`/v1/conversations`) uses `MessageInputContentChunks` and `MessageOutputContentChunks`, which have a **different set of chunk types** than the **Chat Completions API** (`/v1/chat/completions`) which uses `ContentChunk`.

- Conversations API **input** supports: `TextChunk`, `ImageURLChunk`, `ToolFileChunk`, `DocumentURLChunk`, `ThinkChunk`
- Conversations API **output** adds: `ToolReferenceChunk`
- Chat Completions API supports: `TextChunk`, `ImageURLChunk`, `DocumentURLChunk`, `ReferenceChunk`, `FileChunk`, `ThinkChunk`, `AudioChunk`
- Chat Completions API does **NOT** support: `ToolFileChunk`, `ToolReferenceChunk`

---

## 1. ALL Content Chunk Types in Conversations API INPUTS

Schema: `MessageInputContentChunks` — array of `anyOf`:

| # | Chunk Type | `type` const | Required Fields | Optional Fields |
|---|---|---|---|---|
| 1 | **TextChunk** | `"text"` | `text: string` | — |
| 2 | **ImageURLChunk** | `"image_url"` | `image_url: ImageURL \| string` | — |
| 3 | **ToolFileChunk** | `"tool_file"` | `tool: BuiltInConnectors \| string`, `file_id: string` | `file_name: string \| null`, `file_type: string \| null` |
| 4 | **DocumentURLChunk** | `"document_url"` | `document_url: string` | `document_name: string \| null` |
| 5 | **ThinkChunk** | `"thinking"` | `thinking: array` | `signature: string \| null`, `closed: boolean (default: true)` |

**NOT in Conversations input:** AudioChunk, ReferenceChunk, FileChunk, ToolReferenceChunk

---

## 2. ALL Content Chunk Types in Conversations API OUTPUTS

Schema: `MessageOutputContentChunks` — array of `anyOf`:

| # | Chunk Type | `type` const | Required Fields | Optional Fields |
|---|---|---|---|---|
| 1 | **TextChunk** | `"text"` | `text: string` | — |
| 2 | **ImageURLChunk** | `"image_url"` | `image_url: ImageURL \| string` | — |
| 3 | **ToolFileChunk** | `"tool_file"` | `tool`, `file_id` | `file_name`, `file_type` |
| 4 | **DocumentURLChunk** | `"document_url"` | `document_url: string` | `document_name` |
| 5 | **ThinkChunk** | `"thinking"` | `thinking: array` | `signature`, `closed` |
| 6 | **ToolReferenceChunk** | `"tool_reference"` | `tool: BuiltInConnectors \| string`, `title: string` | `url: string \| null`, `favicon: string \| null`, `description: string \| null` |

**ToolReferenceChunk** is **output-only** — it cannot be sent as input.

---

## 3. ThinkChunk — How It Works as Input

### Schema (from OpenAPI spec)

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "thinking"},
    "thinking": {
      "type": "array",
      "items": {
        "anyOf": [
          {"$ref": "#/components/schemas/TextChunk"},
          {"$ref": "#/components/schemas/ToolReferenceChunk"},
          {"$ref": "#/components/schemas/ReferenceChunk"}
        ]
      }
    },
    "signature": {
      "anyOf": [{"type": "string"}, {"type": "null"}],
      "description": "Signature to replay some reasoning blocks across turns."
    },
    "closed": {
      "type": "boolean",
      "default": true,
      "description": "Whether the thinking chunk is closed or not. Currently only used for prefixing."
    }
  },
  "required": ["thinking"]
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"thinking"` (const) | yes | Discriminator |
| `thinking` | `array` of (TextChunk \| ToolReferenceChunk \| ReferenceChunk) | yes | The reasoning trace content. Note: it is an **array of chunks**, not a plain string. Most commonly contains `TextChunk` objects, but can also contain `ToolReferenceChunk` and `ReferenceChunk` (e.g. when the model references sources during reasoning). |
| `signature` | `string \| null` | no | Opaque signature for replaying reasoning blocks across turns. Used for model integrity verification when replaying thinking chunks. |
| `closed` | `boolean` (default `true`) | no | Whether the thinking chunk is closed. Set to `false` when using ThinkChunk as a **prefix** (predicted outputs / assistant prefix). When `false`, the thinking is treated as an open/incomplete reasoning block that the model continues from. Currently only used for prefixing. |

### Can You Send Thinking/Reasoning Content as Context?

**Yes.** The Mistral docs explicitly say:

> "When building multi-turn conversations with reasoning, **always replay the full assistant message (including ThinkChunk) back into the message history**. Dropping the reasoning trace across turns degrades model performance."
>
> "Do not strip ThinkChunk from assistant messages before replaying them. The model relies on the reasoning trace to maintain coherence across turns."

The `signature` field should be preserved when replaying ThinkChunk across turns — it allows the model to verify and replay reasoning blocks.

The `closed` field set to `false` is used for **prefixing** — sending an incomplete thinking chunk that the model should continue from (similar to assistant prefix in predicted outputs).

### ThinkChunk in System Messages

The `SystemMessageContentChunks` schema allows `TextChunk` and `ThinkChunk` in system messages, meaning thinking chunks can appear in system messages too.

---

## 4. ToolFileChunk — How It Works

### Schema

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "tool_file"},
    "tool": {
      "anyOf": [
        {"$ref": "#/components/schemas/BuiltInConnectors"},
        {"type": "string"}
      ]
    },
    "file_id": {"type": "string"},
    "file_name": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    "file_type": {"anyOf": [{"type": "string"}, {"type": "null"}]}
  },
  "required": ["tool", "file_id"]
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"tool_file"` (const) | yes | Discriminator |
| `tool` | `BuiltInConnectors \| string` | yes | The tool/connector that generated the file. BuiltInConnectors enum: `"web_search"`, `"web_search_premium"`, `"code_interpreter"`, `"image_generation"`, `"document_library"`. Can also be a custom connector name (string). |
| `file_id` | `string` | yes | The ID of the file generated by the tool. |
| `file_name` | `string \| null` | no | The filename of the generated file. |
| `file_type` | `string \| null` | no | The MIME type or file extension of the generated file. |

### Purpose

ToolFileChunk represents files produced by built-in tools or connectors (e.g., images from `image_generation`, charts from `code_interpreter`). These appear in both input (replaying previous tool outputs) and output (new tool-generated files in the assistant response).

**Only available in Conversations API**, not in Chat Completions API.

---

## 5. ToolReferenceChunk — Output-Only Citations from Tools

### Schema

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "tool_reference"},
    "tool": {
      "anyOf": [
        {"$ref": "#/components/schemas/BuiltInConnectors"},
        {"type": "string"}
      ]
    },
    "title": {"type": "string"},
    "url": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    "favicon": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    "description": {"anyOf": [{"type": "string"}, {"type": "null"}]}
  },
  "required": ["tool", "title"]
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"tool_reference"` (const) | yes | Discriminator |
| `tool` | `BuiltInConnectors \| string` | yes | The tool that produced the reference (e.g., `"web_search"`, `"document_library"`, or a custom connector name). |
| `title` | `string` | yes | Title of the referenced source. |
| `url` | `string \| null` | no | URL of the referenced source (e.g., a web page URL from web search). |
| `favicon` | `string \| null` | no | Favicon URL of the referenced source. |
| `description` | `string \| null` | no | Short description/snippet of the referenced content. |

### Purpose

ToolReferenceChunk appears **only in outputs** (MessageOutputContentChunks). It represents citations/references produced by tools like `web_search` or `document_library`. For example, when the model uses web search and cites a source, a ToolReferenceChunk is emitted with the source's title, URL, favicon, and description.

It can also appear **inside ThinkChunk.thinking** as part of the reasoning trace — the model may reference tool sources during its thinking phase.

**Only available in Conversations API**, not in Chat Completions API.

---

## 6. Audio Input (input_audio) Support

### Chat Completions API: ✅ YES

The `ContentChunk` oneOf in Chat Completions includes `AudioChunk` with `type: "input_audio"`.

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "input_audio"},
    "input_audio": {
      "anyOf": [
        {"type": "string"},
        {"type": "string", "format": "binary"}
      ]
    }
  },
  "required": ["input_audio"]
}
```

**Usage:** Supported with Voxtral models (`voxtral-small-latest`) for chat use cases. You pass base64-encoded audio or a URL as `input_audio`. The audio doc shows examples like:

```python
{"type": "input_audio", "input_audio": audio_base64}
```

Three ways to pass audio:
1. **Base64 encoded** — pass the base64 string directly as `input_audio`
2. **Audio URL** — pass a publicly accessible URL
3. **Uploaded file** — upload via Files API, then reference

### Conversations API: ❌ NOT listed

The `MessageInputContentChunks` and `MessageOutputContentChunks` schemas do **NOT** include `AudioChunk`. Audio input is not a listed chunk type in the Conversations API.

**However**, audio may still work through the Conversations API if the underlying model supports it, since the Conversations API is built on top of Chat Completions. But the OpenAPI spec does not formally include AudioChunk in the Conversations content chunk schemas.

---

## 7. File Content Type Support

### Chat Completions API: ✅ YES — via FileChunk

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "file"},
    "file_id": {"type": "string", "format": "uuid"}
  },
  "required": ["file_id"]
}
```

FileChunk allows referencing a previously uploaded file by its UUID `file_id`. This is the Chat Completions API's way to include files (uploaded via the Files API) as content.

### Conversations API: ❌ NOT listed

FileChunk is **NOT** in `MessageInputContentChunks` or `MessageOutputContentChunks`. In the Conversations API, file-like content is handled via `ToolFileChunk` (for tool-generated files) and `DocumentURLChunk` (for document URLs). There is no generic `file_id`-based file reference in the Conversations API content chunks.

### OpenAI Comparison

OpenAI does not have a direct `file` content type in Chat Completions. OpenAI uses `file_id` within tool message content or the Assistants API's file attachments. Mistral's `FileChunk` is unique to Mistral.

---

## 8. Handling OpenAI's input_audio in a Mistral Proxy

OpenAI's Chat Completions API supports `input_audio` content type with:
```json
{"type": "input_audio", "input_audio": {"data": "<base64>", "format": "wav|mp3"}}
```

### Mistral Chat Completions API: Compatible with adaptation

Mistral's `AudioChunk` has `type: "input_audio"` and `input_audio: string | binary`. The structure is **simpler** than OpenAI's:
- OpenAI uses an object: `{"data": "...", "format": "wav"}`
- Mistral uses a plain string (base64 data or URL)

**Conversion strategy:**
- Extract `data` from OpenAI's `input_audio` object
- Pass it directly as `input_audio` string in Mistral's format
- Discard the `format` field (Mistral auto-detects)
- Only works with Voxtral models (`voxtral-small-latest`)

### Mistral Conversations API: No native support

If proxying to the Conversations API, `input_audio` is not in the content chunk schema. Options:
1. **Fall back to Chat Completions API** for requests with audio input
2. **Transcribe first** using the Audio Transcriptions API, then send the text as a TextChunk
3. **Return an error** if the target model doesn't support audio

### Recommended proxy behavior:
```python
if content_type == "input_audio":
    # For Chat Completions API target:
    mistral_chunk = {
        "type": "input_audio",
        "input_audio": openai_chunk["input_audio"]["data"]  # extract base64 from object
    }
    # For Conversations API target:
    # AudioChunk not in schema — fall back to Chat Completions or transcribe first
```

---

## 9. ImageURLChunk detail Parameter

### Yes, Mistral supports the `detail` parameter

The `ImageURLChunk.image_url` field can be either a plain `string` (the URL) or an `ImageURL` object:

```json
{
  "ImageURL": {
    "type": "object",
    "properties": {
      "url": {"type": "string"},
      "detail": {"anyOf": [{"$ref": "#/components/schemas/ImageDetail"}, {"type": "null"}]}
    },
    "required": ["url"]
  }
}
```

The `ImageDetail` enum:
```json
{"enum": ["low", "auto", "high"]}
```

### Values
| Value | Description |
|---|---|
| `"low"` | Low detail — fewer tokens consumed for image processing |
| `"auto"` | Automatic detail selection (default behavior) |
| `"high"` | High detail — more tokens consumed for finer image analysis |

### OpenAI Comparison

This is **identical to OpenAI's** image_url content type, which also supports `detail: "low" | "auto" | "high"`. The proxy can pass this through directly when using the object form. When `image_url` is a plain string, detail defaults to `auto`.

### Usage examples

```json
// String form (simplest)
{"type": "image_url", "image_url": "https://example.com/image.png"}

// Object form with detail
{"type": "image_url", "image_url": {"url": "https://example.com/image.png", "detail": "high"}}

// Base64 data URL
{"type": "image_url", "image_url": "data:image/png;base64,iVBORw0..."}
```

---

## 10. ReferenceChunk (reference_ids) Handling

### Schema

```json
{
  "type": "object",
  "properties": {
    "type": {"type": "string", "const": "reference"},
    "reference_ids": {
      "type": "array",
      "items": {"anyOf": [{"type": "integer"}, {"type": "string"}]}
    }
  },
  "required": ["reference_ids"]
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"reference"` (const) | yes | Discriminator |
| `reference_ids` | `array` of (`integer \| string`) | yes | Array of reference IDs that cite sources from the tool call results. |

### How It Works

ReferenceChunk is used in the **Chat Completions API** to provide inline citations. When the model uses a tool that returns references (e.g., a RAG retrieval function returning documents with numbered IDs), the model's response includes `ReferenceChunk` objects that point back to those reference IDs.

The `reference_ids` array contains integers or strings that map to keys in the references object returned by the tool. For example, if a tool returns:
```json
{"0": {"url": "...", "title": "...", "snippets": [...]},
 "1": {"url": "...", "title": "...", "snippets": [...]}}
```
The model's response may include:
```json
{"type": "reference", "reference_ids": [0, 1]}
```

### Conversations API vs Chat Completions API

- **Chat Completions API**: ReferenceChunk is in `ContentChunk` — appears in both input and output message content
- **Conversations API**: ReferenceChunk is **NOT** in `MessageInputContentChunks` or `MessageOutputContentChunks`. However, it **CAN appear inside ThinkChunk.thinking** (since ThinkChunk's thinking array allows ReferenceChunk as an item type)

### OpenAI Comparison

OpenAI does not have an equivalent content chunk type. OpenAI handles citations differently (through annotations in the Assistants API, not as content chunks in Chat Completions).

### Proxy Handling Strategy

When proxying from OpenAI to Mistral:
- OpenAI has no ReferenceChunk equivalent → no conversion needed from OpenAI side
- When proxying Mistral responses back to OpenAI format, ReferenceChunk should be stripped from content and citations could be appended to the response message as annotations or metadata

---

## Complete Schema Reference: BuiltInConnectors

The `tool` field in ToolFileChunk and ToolReferenceChunk accepts either a `BuiltInConnectors` enum value or a custom string:

```json
{"enum": ["web_search", "web_search_premium", "code_interpreter", "image_generation", "document_library"]}
```

---

## Summary: Conversations API Content Architecture

```
ConversationRequest
  └── inputs: string | InputEntries[]
       └── InputEntries[]: 
            ├── MessageInputEntry (role: user|assistant, content: string | MessageInputContentChunks)
            │    └── MessageInputContentChunks[]:
            │         ├── TextChunk          {type:"text", text}
            │         ├── ImageURLChunk       {type:"image_url", image_url: string|ImageURL{url, detail?}}
            │         ├── ToolFileChunk       {type:"tool_file", tool, file_id, file_name?, file_type?}
            │         ├── DocumentURLChunk    {type:"document_url", document_url, document_name?}
            │         └── ThinkChunk          {type:"thinking", thinking: [TextChunk|ToolReferenceChunk|ReferenceChunk], signature?, closed?}
            ├── MessageOutputEntry (role: assistant, content: string | MessageOutputContentChunks)
            │    └── MessageOutputContentChunks[]:
            │         ├── TextChunk
            │         ├── ImageURLChunk
            │         ├── ToolFileChunk
            │         ├── DocumentURLChunk
            │         ├── ThinkChunk
            │         └── ToolReferenceChunk  {type:"tool_reference", tool, title, url?, favicon?, description?}
            ├── FunctionCallEntry    {type:"function.call", tool_call_id, name, arguments, confirmation_status?}
            ├── FunctionResultEntry  {type:"function.result", tool_call_id, result}
            ├── ToolExecutionEntry   {type:"tool.execution", name, arguments, info}
            └── AgentHandoffEntry    {type:"agent.handoff", previous_agent_id, previous_agent_name, next_agent_id, next_agent_name}
```

## OpenAI → Mistral Content Type Mapping

| OpenAI Content Type | Mistral Chat Completions | Mistral Conversations API | Notes |
|---|---|---|---|
| `{"type": "text", "text": "..."}` | ✅ TextChunk (identical) | ✅ TextChunk (identical) | Direct passthrough |
| `{"type": "image_url", "image_url": {"url": "...", "detail": "..."}}` | ✅ ImageURLChunk (identical) | ✅ ImageURLChunk (identical) | Direct passthrough, detail supported |
| `{"type": "input_audio", "input_audio": {"data": "...", "format": "wav"}}` | ✅ AudioChunk (adapt: extract `data` to plain string) | ❌ Not in schema | Fall back to Chat Completions or transcribe first |
| `{"type": "file", "file_id": "..."}` | ❌ Not an OpenAI type | N/A | Mistral-only (FileChunk in Chat Completions) |
| N/A | N/A | ToolFileChunk | Mistral-only (Conversations API) |
| N/A | N/A | ToolReferenceChunk | Mistral-only (Conversations output) |
| N/A | ReferenceChunk | ❌ Not in Conversations (except inside ThinkChunk) | Mistral-only (Chat Completions citations) |
| N/A | ThinkChunk | ThinkChunk | Mistral-only reasoning replay |

---

## Recommendations for Proxy Implementation

1. **TextChunk**: Pass through directly — identical format.
2. **ImageURLChunk**: Pass through directly — `detail` parameter is fully compatible.
3. **input_audio**: Extract `data` from OpenAI's object format and pass as plain string to Mistral Chat Completions. For Conversations API, fall back to Chat Completions or transcribe first.
4. **ThinkChunk**: When converting Mistral responses to OpenAI format, strip ThinkChunk from the content array and optionally expose reasoning via a separate field. When proxying OpenAI requests to Mistral with reasoning models, no ThinkChunk input is needed (the model generates it).
5. **ReferenceChunk**: Strip from OpenAI-facing responses, or convert to OpenAI annotations/metadata.
6. **ToolReferenceChunk**: Strip from OpenAI-facing responses, or convert to annotations.
7. **ToolFileChunk**: Convert to a file reference or URL in OpenAI format.
8. **DocumentURLChunk**: Mistral-only — convert to a text description or file reference for OpenAI.
9. **FileChunk**: Mistral-only (Chat Completions) — no direct OpenAI equivalent.
