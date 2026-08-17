# 修复总结：基于其他 API 转换项目的实现方案

## 参考项目

| 项目 | Stars | 转换方向 | 关键参考点 |
|---|---|---|---|
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 56K+ | OpenAI ↔ Mistral/Anthropic 等 | Mistral 配置、工具 schema 清理、reasoning 处理、消息转换 |
| [enerBydev/nexus-ai-gateway](https://github.com/enerBydev/nexus-ai-gateway) | - | Anthropic → OpenAI | 流式处理、thinking→text 降级、stream_options |
| [childe/convert-openai-to-claude](https://github.com/childe/convert-openai-to-claude) | - | Claude → OpenAI | tool_choice 转换、content block 处理 |
| [Mirrowel/LLM-API-Key-Proxy](https://github.com/Mirrowel/LLM-API-Key-Proxy) | 543 | Universal LLM Gateway | 多 provider 统一接口 |

## 已实施的修复 (20项)

### 请求参数转换 (P0-P1)

1. **reasoning_effort 完整映射** — 参考 LiteLLM 直接透传方式
   - 之前: `low/none → none`, 其余 → `high` (丢失 minimal/medium/xhigh)
   - 现在: 直接透传 `none/minimal/low/medium/high`, `max → xhigh`

2. **max_completion_tokens → max_tokens** — 参考 LiteLLM/Anthropic handler
   - 所有参考项目都映射此参数

3. **tool_choice 对象形式 → 'any'** — 参考 LiteLLM Mistral handler
   - LiteLLM: `_map_tool_choice` 将对象形式 fallback 到 `'any'`
   - Conversations API 不支持对象形式，`'any'` 是最接近的语义

4. **developer 角色** — OpenAI 新 API 用 `developer` 替代 `system`

### 响应翻译 (P1)

5. **extractText() 处理所有内容块类型** — 参考 LiteLLM `_handle_content_list_to_str_conversion`
   - `tool_reference` → `[title](url)` markdown 链接
   - `tool_file` → `[File: name]`
   - `image_url` → `![image](url)`
   - `document_url` → `[Document: name]`

6. **agent.handoff 非流式响应处理** — 与流式行为一致
   - 追加 `[Handed off from X to Y]` 到消息内容

7. **connector_tokens/connectors 保留** — 扩展 usage 对象

### 流式翻译 (P1-P2)

8. **流式 ToolReferenceChunk 包含 URL** — 之前只输出 `[title]`
9. **流式 tool_file/image_url/document_url 处理** — 之前被跳过

### 内容类型 (P2)

10. **ThinkChunk 在输入中保留回放** — 参考 Mistral 官方文档
    - "始终将完整的 assistant 消息（包括 ThinkChunk）回放到消息历史中"
11. **ToolFileChunk/ToolReferenceChunk 在 translateContent 中保留**
12. **reasoning_content → ThinkChunk 转换** — 参考 LiteLLM `_strip_output_only_fields`
    - OpenAI 客户端发送的 `reasoning_content` 转换为 Mistral ThinkChunk

### 工具处理 (P2)

13. **cleanToolSchema() 工具 schema 清理** — 参考 LiteLLM `_clean_tool_schema_for_mistral`
    - 移除 `$id`, `$schema`, `additionalProperties:false`
14. **web_search_preview → web_search 映射** — OpenAI 工具类型映射

### 流式选项 (P2-P3)

15. **stream_options.include_usage 支持** — 参考 nexus-ai-gateway
    - 当 `include_usage: false` 时不发送 usage
    - 默认包含 usage (兼容性)

## 无法修复的差距 (API 限制)

| 参数 | 原因 |
|---|---|
| parallel_tool_calls | Conversations API CompletionArgs 不支持 |
| n | 不支持多选 |
| logprobs/top_logprobs | 不支持 |
| logit_bias | 不支持 |
| modalities/audio | 不支持 |
| service_tier | 不支持 |
| user | 不支持 |
| verbosity | 不支持 |
| tool_choice 对象形式 | 降级为 'any' (无法指定具体函数) |
| input_audio | Conversations API 内容块 schema 不包含 AudioChunk |
