# Conversations API → Chat Completions API 转换差距分析

> 基于 5 个子代理对 Mistral 官方文档 (https://docs.mistral.ai/openapi.yaml) 和 OpenAI 官方文档的全面调查

---

## 一、请求参数转换差距（OpenAI Chat Completions → Mistral Conversations）

### 1.1 reasoning_effort — 值映射不完整 ⚠️ 中等

**现状**: 代码将 `low/none` → `none`，其余 → `high`，丢失了 `minimal`、`medium`、`xhigh` 三个档位。

**Mistral 支持的值**: `none | minimal | low | medium | high | xhigh` (6 档)
**OpenAI 支持的值**: `none | minimal | low | medium | high | max` (6 档，OpenAI 有 `max` 无 `xhigh`)

**修复**: 应直接透传 `none/minimal/low/medium/high`，将 OpenAI 的 `max` 映射为 `xhigh`。

### 1.2 tool_choice 对象形式 — 未支持 ⚠️ 中等

**现状**: 对象形式 `{"type":"function","function":{"name":"my_func"}}` 直接跳过，默认 `auto`。

**Mistral Conversations API**: 只支持字符串枚举 `auto|none|any|required`，不支持对象形式。
**Mistral Chat Completions API**: 支持对象形式。

**修复**: Conversations API 不支持对象形式，无法直接修复。可以记录 warning 或返回错误提示。

### 1.3 parallel_tool_calls — 未处理 ℹ️ 低

**现状**: 未传递给 Mistral。

**Mistral Conversations API**: `CompletionArgs` 中 **不支持** `parallel_tool_calls`。
**Mistral Chat Completions API**: 支持 `parallel_tool_calls`（默认 `true`）。

**结论**: Conversations API 本身不支持，无法修复。模型自动决定是否并行调用。

### 1.4 stream_options — 未处理 ℹ️ 低

**现状**: 未处理 `stream_options.include_usage`。

**Mistral**: 不支持 `stream_options`。但 `conversation.response.done` 事件始终包含 `usage`。

**结论**: 当前流式响应始终在 `conversation.response.done` 中发送 usage，行为已兼容。无需额外处理。

### 1.5 max_completion_tokens → max_tokens — 未映射 ⚠️ 中等

**现状**: 只映射了 `max_tokens`，未映射 OpenAI 新参数 `max_completion_tokens`。

**修复**: 增加 `body.max_completion_tokens` → `completionArgs.max_tokens` 的映射。

### 1.6 其他 OpenAI 参数（无 Mistral 等价物）

| OpenAI 参数 | Mistral Conversations 支持? | 说明 |
|---|---|---|
| `user` | ❌ | Mistral 两个 API 都不支持 |
| `n` | ❌ | Conversations 不支持多选 |
| `logprobs` | ❌ | 不支持 |
| `top_logprobs` | ❌ | 不支持 |
| `logit_bias` | ❌ | 不支持 |
| `modalities` | ❌ | 不支持 |
| `audio` | ❌ | 不支持 |
| `service_tier` | ❌ | 不支持 |
| `verbosity` | ❌ | 不支持 |
| `web_search_options` | ❌ | Mistral 用 `web_search` 工具类型代替 |
| `safe_prompt` | ❌ | 仅 Chat Completions 支持 |
| `prompt_cache_key` | ❌ | 仅 Chat Completions 支持 |

**结论**: 这些参数在 Mistral Conversations API 中无对应，无法转换，可安全忽略。

---

## 二、响应翻译差距（Mistral Conversations → OpenAI Chat Completions）

### 2.1 agent.handoff — 非流式响应中未处理 ⚠️ 中等

**现状**: `translateResponse()` 中 `agentHandoffs` 变量被创建但从未使用。

**修复**: 将 handoff 信息作为可读文本追加到消息内容中：
```js
for (const ho of agentHandoffs) {
  toolResultParts.push(`[Handed off from ${ho.previous_agent_name} to ${ho.next_agent_name}]`);
}
```

### 2.2 ToolReferenceChunk — extractText() 中静默丢弃 ⚠️ 中等

**现状**: `extractText()` 对 `tool_reference` 类型返回 `part.text || ''`，由于没有 `text` 字段，内容被丢弃。

**修复**:
```js
if (part.type === 'tool_reference') {
  const title = part.title || part.tool;
  return part.url ? `[${title}](${part.url})` : `[${title}]`;
}
```

### 2.3 ToolFileChunk — extractText() 中静默丢弃 ⚠️ 中等

**现状**: `tool_file` 类型同样被丢弃。

**修复**:
```js
if (part.type === 'tool_file') {
  return `[File: ${part.file_name || part.file_id}]`;
}
```

### 2.4 ImageURLChunk — extractText() 中静默丢弃 ⚠️ 中等

**现状**: 输出消息中的 `image_url` 类型被丢弃。

**修复**:
```js
if (part.type === 'image_url') {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url || '';
  return url ? `![image](${url})` : '[image]';
}
```

### 2.5 DocumentURLChunk — extractText() 中静默丢弃 ⚠️ 中等

**现状**: 输出消息中的 `document_url` 类型被丢弃。

**修复**:
```js
if (part.type === 'document_url') {
  return `[Document: ${part.document_name || part.document_url}]`;
}
```

### 2.6 connector_tokens / connectors — usage 中丢弃 ℹ️ 低

**现状**: 只返回 `prompt_tokens/completion_tokens/total_tokens`，丢弃了 `connector_tokens` 和 `connectors` 分项。

**修复**: 可选择性加入 `usage` 对象作为扩展字段，严格 OpenAI 客户端会忽略。

### 2.7 system_fingerprint — 正确省略 ✅

Mistral API 不提供此字段，当前不返回是正确的。

### 2.8 finish_reason — 无直接字段 ✅ 正确推断

Mistral Conversations API 无 `finish_reason` 字段，当前从 outputs 推断 (`tool_calls`/`stop`) 是正确的。`length` 无法检测。

---

## 三、内容类型转换差距

### 3.1 input_audio — 跳过未处理 ℹ️ 低

**现状**: 代码注释为 skip。Mistral Conversations API 的内容块 schema 不包含 `AudioChunk`。

**结论**: Conversations API 不支持音频输入。可选方案：转回 Chat Completions API 或先转录为文本。

### 3.2 ThinkChunk 作为输入回放 — 未保留 ℹ️ 低

**现状**: 多轮对话中，assistant 消息的 thinking 内容在 `extractText()` 中返回空字符串，不会被回放。

**Mistral 文档**: "始终将完整的 assistant 消息（包括 ThinkChunk）回放到消息历史中。丢弃推理轨迹会降低模型性能。"

**修复**: 在 `translateContent()` 中保留 ThinkChunk，在 assistant 消息中作为 content chunk 数组的一部分传回。

### 3.3 ToolFileChunk 作为输入 — 未处理 ℹ️ 低

**现状**: `translateContent()` 不处理 `tool_file` 类型。

**修复**: 添加 tool_file 到 `translateContent()` 的处理分支，直接透传。

---

## 四、流式翻译差距

### 4.1 ToolReferenceChunk 在流式中 — 部分处理 ✅

**现状**: 流式路径中 `tool_reference` 被转换为 `[${chunk.title || chunk.tool}]`，但未包含 URL。

**修复建议**: 改为 `[${title}](${url})` 格式与非流式一致。

### 4.2 ToolFileChunk 在流式中 — 未处理 ⚠️ 中等

**现状**: 流式 `message.output.delta` 中的 `tool_file` 类型未被处理，被跳过。

**修复**: 添加 `tool_file` 处理分支，emit 为 content delta。

### 4.3 content_index — 正确忽略 ✅

OpenAI 流式格式不支持多部分内容，当前将不同 `content_index` 的文本拼接为单一文本流是正确的。

---

## 五、优先级排序的修复清单

| 优先级 | 问题 | 影响 |
|---|---|---|
| P0 | reasoning_effort 值映射不完整 (丢失 minimal/medium/xhigh) | 推理模型行为不正确 |
| P1 | extractText() 丢弃 ToolReferenceChunk/ToolFileChunk/ImageURLChunk/DocumentURLChunk | 输出内容丢失 |
| P1 | agent.handoff 非流式响应未处理 | 多智能体场景信息丢失 |
| P1 | max_completion_tokens 未映射到 max_tokens | OpenAI 新参数不工作 |
| P2 | ThinkChunk 未在输入中保留回放 | 多轮推理性能下降 |
| P2 | ToolFileChunk 在流式中未处理 | 流式输出丢失工具文件 |
| P2 | ToolReferenceChunk 流式中未包含 URL | 引用信息不完整 |
| P3 | connector_tokens/connectors usage 丢弃 | 细粒度用量信息丢失 |
| P3 | input_audio 不支持 | 音频输入不工作（API 限制） |
| N/A | parallel_tool_calls, n, logprobs 等 | API 本身不支持，无法修复 |
