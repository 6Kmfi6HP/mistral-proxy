// Cloudflare Worker：把 OpenAI 格式的 /v1/chat/completions 请求
// 翻译成 Mistral /v1/conversations 格式转发，再把响应翻译回 OpenAI 格式。
// 支持流式输出、function calling、多模态内容、内置工具、API Key 自动透传。
//
// 部署：
//   wrangler deploy worker.js --name mistral-proxy
//
// 用法（API Key 由客户端 Authorization 头自动透传）：
//   curl https://mistral-proxy.<worker>.workers.dev/v1/chat/completions \
//     -H "Authorization: Bearer <key>" \
//     -d '{"model":"mistral-large-latest","messages":[{"role":"user","content":"Hi"}]}'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- CORS 预检 ----
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // ---- 健康检查 ----
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'mistral-proxy' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ---- API Key：优先从客户端 Authorization 头透传，回退到环境变量 ----
    let apiKey = env.MISTRAL_API_KEY || '';
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7).trim();
    }
    if (!apiKey) {
      return corsResponse(new Response(JSON.stringify({
        error: 'No API key. Send "Authorization: Bearer <key>" header or set MISTRAL_API_KEY env var.',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    }

    // ---- 路由 1：模型列表 /v1/models（OpenAI 兼容格式，直接透传）----
    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return corsResponse(await proxyPassThrough(request, apiKey, 'https://api.mistral.ai/v1/models'));
    }

    // ---- 路由 2：单个模型 /v1/models/{model_id}（直接透传）----
    const modelMatch = url.pathname.match(/^\/v1\/models\/([^/]+)$/);
    if (modelMatch && request.method === 'GET') {
      return corsResponse(await proxyPassThrough(request, apiKey, `https://api.mistral.ai/v1/models/${modelMatch[1]}`));
    }

    // ---- 路由 3：Embeddings /v1/embeddings（直接透传）----
    if (url.pathname === '/v1/embeddings') {
      return corsResponse(await proxyPassThrough(request, apiKey, 'https://api.mistral.ai/v1/embeddings'));
    }

    // ---- 路由 4：聊天补全 /v1/chat/completions（需格式翻译）----
    if (url.pathname !== '/v1/chat/completions') {
      return corsResponse(new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ---- 解析客户端请求体 ----
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (!body.messages || !Array.isArray(body.messages)) {
      return corsResponse(new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ---- 请求翻译：OpenAI → Mistral conversations ----
    const convBody = translateRequest(body);
    const wantStream = body.stream === true;
    if (wantStream) convBody.stream = true;

    const mistralResp = await fetch('https://api.mistral.ai/v1/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(convBody),
    });

    if (!mistralResp.ok) {
      const t = await mistralResp.text();
      return corsResponse(new Response(t, {
        status: mistralResp.status,
        headers: {
          'Content-Type': mistralResp.headers.get('Content-Type') || 'application/json',
        },
      }));
    }

    // ---- 非流式：翻译整个响应体 ----
    if (!wantStream) {
      const convData = await mistralResp.json();
      const chatResp = translateResponse(convData, body.model);
      return corsResponse(new Response(JSON.stringify(chatResp), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ---- 流式：把 Mistral SSE 翻译成 OpenAI SSE ----
    const streamOptions = body.stream_options || {};
    return corsResponse(streamResponse(mistralResp, body.model, streamOptions));
  },
};

// ============================================================
//  CORS 辅助
// ============================================================
function corsResponse(resp) {
  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

// ============================================================
//  请求翻译：OpenAI chat/completions → Mistral conversations
// ============================================================
function translateRequest(body) {
  const completionArgs = {};
  if (body.temperature !== undefined) completionArgs.temperature = body.temperature;
  if (body.max_tokens !== undefined) completionArgs.max_tokens = body.max_tokens;
  if (body.max_completion_tokens !== undefined) completionArgs.max_tokens = body.max_completion_tokens;
  if (body.top_p !== undefined) completionArgs.top_p = body.top_p;
  if (body.presence_penalty !== undefined) completionArgs.presence_penalty = body.presence_penalty;
  if (body.frequency_penalty !== undefined) completionArgs.frequency_penalty = body.frequency_penalty;
  if (body.stop !== undefined) completionArgs.stop = body.stop;
  if (body.random_seed !== undefined) completionArgs.random_seed = body.random_seed;
  if (body.seed !== undefined) completionArgs.random_seed = body.seed;
  if (body.response_format !== undefined) completionArgs.response_format = body.response_format;
  if (body.prediction !== undefined) completionArgs.prediction = body.prediction;
  // Mistral Conversations API only accepts 'none' or 'high' for reasoning_effort.
  // Map OpenAI values (none/minimal/low/medium/high/max) accordingly:
  //   none/minimal/low → 'none'
  //   medium/high/max  → 'high'
  if (body.reasoning_effort !== undefined) {
    const re = String(body.reasoning_effort).toLowerCase();
    const noneEfforts = ['none', 'minimal', 'low'];
    completionArgs.reasoning_effort = noneEfforts.includes(re) ? 'none' : 'high';
  }

  // tool_choice: OpenAI "required" → Mistral "required"; "auto"/"none" same
  if (body.tool_choice !== undefined) {
    if (body.tool_choice === 'required') {
      completionArgs.tool_choice = 'required';
    } else if (typeof body.tool_choice === 'string') {
      // "auto" or "none" — Mistral supports these directly
      completionArgs.tool_choice = body.tool_choice;
    }
    // If tool_choice is an object (specific function), Mistral Conversations API
    // only supports string enums (auto/none/required), so fall back to 'required'
    // (forces tool use, closest to specifying a specific function)
    else if (typeof body.tool_choice === 'object') {
      completionArgs.tool_choice = 'required';
    }
  }

  // system 消息拆到 instructions；tool 消息转 function.result；
  // assistant 的 tool_calls 拆成独立的 function.call 条目
  const systemParts = [];
  const inputs = [];

  for (const m of body.messages) {
    if (!m || typeof m !== 'object') continue;

    if (m.role === 'system' || m.role === 'developer') {
      // OpenAI uses 'developer' as alias for 'system' in newer API versions
      const text = extractText(m.content);
      if (text) systemParts.push(text);
    } else if (m.role === 'user') {
      inputs.push({ role: 'user', content: translateContent(m.content) });
    } else if (m.role === 'assistant') {
      // assistant 文本内容（如果有）
      // If assistant message has reasoning_content, convert to ThinkChunk for replay
      // (Mistral docs: "always replay the full assistant message including ThinkChunk")
      const text = extractText(m.content);
      const hasReasoning = m.reasoning_content || (Array.isArray(m.content) &&
        m.content.some(p => p.type === 'thinking'));
      if (text || hasReasoning) {
        const contentChunks = Array.isArray(m.content) ? translateContent(m.content) : text;
        const entry = { role: 'assistant', content: contentChunks };
        if (m.prefix) entry.prefix = true;
        // If reasoning_content exists as a separate field, inject as ThinkChunk
        if (m.reasoning_content && !Array.isArray(m.content)) {
          entry.content = [
            { type: 'thinking', thinking: [{ type: 'text', text: m.reasoning_content }], closed: true },
            { type: 'text', text: text },
          ];
        }
        inputs.push(entry);
      }
      // assistant 的 tool_calls → function.call 条目
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          inputs.push({
            type: 'function.call',
            tool_call_id: tc.id,
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments),
          });
        }
      }
    } else if (m.role === 'tool') {
      // OpenAI tool 角色 → conversations function.result
      inputs.push({
        type: 'function.result',
        tool_call_id: m.tool_call_id,
        result: extractText(m.content),
      });
    } else if (m.role === 'function') {
      // Legacy function role — treat as function.result if tool_call_id exists
      if (m.tool_call_id || m.name) {
        inputs.push({
          type: 'function.result',
          tool_call_id: m.tool_call_id || m.name,
          result: extractText(m.content),
        });
      }
    }
  }

  const instructions = systemParts.join('\n\n');

  // Build tools array: pass through OpenAI-format function tools + translate built-in tools
  const tools = translateTools(body.tools);

  // Build the conversation request body
  const convBody = {
    model: body.model,
    inputs,
    completion_args: completionArgs,
  };

  if (instructions) convBody.instructions = instructions;
  if (tools.length > 0) convBody.tools = tools;
  if (body.store !== undefined) convBody.store = body.store;
  if (body.handoff_execution !== undefined) convBody.handoff_execution = body.handoff_execution;
  if (body.metadata !== undefined) convBody.metadata = body.metadata;
  if (body.name !== undefined) convBody.name = body.name;
  if (body.guardrails !== undefined) convBody.guardrails = body.guardrails;
  if (body.agent_id !== undefined) convBody.agent_id = body.agent_id;
  if (body.agent_version !== undefined) convBody.agent_version = body.agent_version;
  if (body.description !== undefined) convBody.description = body.description;

  return convBody;
}

// ============================================================
//  内容翻译：OpenAI content → Mistral content
//  OpenAI content 可以是 string 或 array of content parts
//  Mistral content 可以是 string 或 array of content chunks
// ============================================================
function translateContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  // OpenAI content parts → Mistral content chunks
  const chunks = [];
  for (const part of content) {
    if (typeof part === 'string') {
      chunks.push({ type: 'text', text: part });
    } else if (part.type === 'text') {
      chunks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      // OpenAI: { type: "image_url", image_url: "url" | { url: "url", detail: "..." } }
      // Mistral: { type: "image_url", image_url: "url" | { url: "url", detail: "..." } }
      const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const detail = typeof part.image_url === 'object' ? part.image_url?.detail : undefined;
      if (detail) {
        chunks.push({ type: 'image_url', image_url: { url: imageUrl, detail } });
      } else {
        chunks.push({ type: 'image_url', image_url: imageUrl });
      }
    } else if (part.type === 'input_audio') {
      // OpenAI audio format → skip (Mistral doesn't support inline audio in conversations)
      // Could convert to base64 document_url if needed
    } else if (part.type === 'document_url') {
      chunks.push({ type: 'document_url', document_url: part.document_url, document_name: part.document_name });
    } else if (part.type === 'thinking') {
      // Preserve ThinkChunk for multi-turn reasoning replay
      // Mistral docs: "always replay the full assistant message including ThinkChunk"
      chunks.push(part);
    } else if (part.type === 'tool_file') {
      // Preserve ToolFileChunk (tool-generated files from previous turns)
      chunks.push(part);
    } else if (part.type === 'tool_reference') {
      // Preserve ToolReferenceChunk from previous assistant outputs
      chunks.push(part);
    } else {
      // Pass through unknown types
      chunks.push(part);
    }
  }
  return chunks;
}

// ============================================================
//  提取文本内容（从 string 或 content parts array）
// ============================================================
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.type === 'thinking') return '';  // thinking handled separately
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

// Extract thinking/reasoning content from Mistral message.output content array.
// Thinking items have shape: { type: 'thinking', thinking: [{ type: 'text', text: '...' }] }
function extractThinking(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const part of content) {
    if (part && part.type === 'thinking' && Array.isArray(part.thinking)) {
      for (const t of part.thinking) {
        if (t.text) parts.push(t.text);
      }
    }
  }
  return parts.join('\n');
}

// ============================================================
//  工具翻译：OpenAI tools → Mistral tools
//  OpenAI function tools format is compatible with Mistral FunctionTool
// ============================================================
// Recursively clean JSON Schema for Mistral compatibility.
// Removes $id, $schema, and additionalProperties:false that cause validation errors.
// Based on LiteLLM's _clean_tool_schema_for_mistral pattern.
function cleanToolSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanToolSchema);
  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$id' || key === '$schema') continue;
    if (key === 'additionalProperties' && value === false) continue;
    cleaned[key] = typeof value === 'object' && value !== null ? cleanToolSchema(value) : value;
  }
  return cleaned;
}

function translateTools(tools) {
  if (!Array.isArray(tools)) return [];

  const result = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (tool.type === 'function' && tool.function) {
      // OpenAI function tool → Mistral FunctionTool (same format)
      // Clean schema: remove $id, $schema that cause validation errors (LiteLLM pattern)
      const params = cleanToolSchema(tool.function.parameters || tool.function.schema || {});
      const fn = {
        type: 'function',
        function: {
          name: tool.function.name,
          parameters: params,
        },
      };
      if (tool.function.description) fn.function.description = tool.function.description;
      if (tool.function.strict !== undefined) fn.function.strict = tool.function.strict;
      result.push(fn);
    } else if (tool.type === 'web_search' || tool.type === 'web_search_preview') {
      // OpenAI's web_search_preview maps to Mistral's web_search
      result.push({ type: 'web_search' });
    } else if (tool.type === 'web_search_premium') {
      result.push({ type: 'web_search_premium' });
    } else if (tool.type === 'code_interpreter') {
      result.push({ type: 'code_interpreter' });
    } else if (tool.type === 'image_generation') {
      result.push({ type: 'image_generation' });
    } else if (tool.type === 'document_library' && tool.library_ids) {
      result.push({ type: 'document_library', library_ids: tool.library_ids });
    } else if (tool.type === 'connector' && tool.connector_id) {
      result.push(tool);
    } else if (tool.type === 'function') {
      // Already in Mistral format
      result.push(tool);
    }
  }
  return result;
}

// ============================================================
//  响应翻译：Mistral conversations → OpenAI chat/completions
// ============================================================
function translateResponse(convData, model) {
  const outputs = Array.isArray(convData.outputs) ? convData.outputs : [];

  // Collect different output types
  const messageOutputs = outputs.filter((o) => o.type === 'message.output');
  const functionCalls = outputs.filter((o) => o.type === 'function.call');
  const toolExecutions = outputs.filter((o) => o.type === 'tool.execution');
  const agentHandoffs = outputs.filter((o) => o.type === 'agent.handoff');

  const message = { role: 'assistant' };

  // Concatenate all message.output text content
  const textParts = [];
  const thinkingParts = [];
  for (const mo of messageOutputs) {
    const text = extractText(mo.content);
    if (text) textParts.push(text);
    const thinking = extractThinking(mo.content);
    if (thinking) thinkingParts.push(thinking);
  }

  // Also extract text from tool execution results (web_search, code_interpreter)
  // These are converted to text annotations in OpenAI format
  const toolResultParts = [];
  for (const te of toolExecutions) {
    const info = te.info || {};
    const name = te.name || 'tool';
    // Extract text from tool execution info
    const toolText = formatToolExecutionResult(name, info, te.arguments);
    if (toolText) toolResultParts.push(toolText);
  }

  // Append agent handoff info as readable text (consistent with streaming behavior)
  for (const ho of agentHandoffs) {
    toolResultParts.push(`[Handed off from ${ho.previous_agent_name} to ${ho.next_agent_name}]`);
  }

  const allText = [...textParts, ...toolResultParts].join('\n\n');
  if (allText) {
    message.content = allText;
  }

  // Include thinking/reasoning content (OpenAI reasoning_content format)
  if (thinkingParts.length > 0) {
    message.reasoning_content = thinkingParts.join('\n');
  }

  // 工具调用
  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map((fc) => ({
      id: fc.tool_call_id,
      type: 'function',
      function: {
        name: fc.name,
        arguments: typeof fc.arguments === 'string'
          ? fc.arguments
          : JSON.stringify(fc.arguments),
      },
    }));
    if (message.content === undefined) message.content = null;
  }

  // Determine finish reason
  let finishReason = 'stop';
  if (functionCalls.length > 0) finishReason = 'tool_calls';
  if (toolExecutions.length > 0 && functionCalls.length === 0) finishReason = 'stop';

  // Extract model and created from first available output
  let respModel = model;
  let createdAt = Math.floor(Date.now() / 1000);
  for (const o of outputs) {
    if (o.model) { respModel = o.model; break; }
  }
  for (const o of outputs) {
    if (o.created_at) {
      createdAt = Math.floor(new Date(o.created_at).getTime() / 1000);
      break;
    }
  }

  // Build usage object
  const usage = convData.usage || {};
  const openaiUsage = {
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
  // Include Mistral-specific connector token usage as extension fields
  // (OpenAI clients will ignore unknown fields; Mistral-aware clients can use them)
  if (usage.connector_tokens !== undefined && usage.connector_tokens !== null) {
    openaiUsage.connector_tokens = usage.connector_tokens;
  }
  if (usage.connectors !== undefined && usage.connectors !== null) {
    openaiUsage.connectors = usage.connectors;
  }

  return {
    id: convData.conversation_id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: createdAt,
    model: respModel,
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason,
    }],
    usage: openaiUsage,
  };
}

// ============================================================
//  格式化工具执行结果为可读文本
// ============================================================
function formatToolExecutionResult(name, info, argumentsStr) {
  // Web search results
  if (name === 'web_search' || name === 'web_search_premium') {
    // API returns info.result (singular, JSON string) or info.results (array)
    let results = info.results || [];
    if (!results.length && info.result) {
      // Parse the result JSON string: {"id": {url, title, description, snippets}, ...}
      try {
        const parsed = typeof info.result === 'string' ? JSON.parse(info.result) : info.result;
        results = Object.values(parsed);
      } catch { results = []; }
    }
    if (results.length > 0) {
      const formatted = results.map((r) => {
        let s = `[${r.title || 'Untitled'}](${r.url || ''})`;
        if (r.description) s += `: ${r.description}`;
        else if (r.content) s += `: ${r.content}`;
        return s;
      });
      return `Web Search Results:\n${formatted.join('\n')}`;
    }
    return null;
  }

  // Code interpreter results
  if (name === 'code_interpreter') {
    if (info.output) return `Code Interpreter Output:\n${info.output}`;
    if (info.error) return `Code Interpreter Error:\n${info.error}`;
    return null;
  }

  // Image generation results
  if (name === 'image_generation') {
    if (info.images && info.images.length > 0) {
      return `Generated ${info.images.length} image(s).`;
    }
    return null;
  }

  // Document library results
  if (name === 'document_library') {
    const results = info.results || [];
    if (results.length > 0) {
      return `Document Library Results:\n${results.map((r) => r.content || r.title || '').join('\n')}`;
    }
    return null;
  }

  // Generic fallback
  if (typeof info === 'object' && Object.keys(info).length > 0) {
    return JSON.stringify(info, null, 2);
  }
  return null;
}

// ============================================================
//  流式翻译：Mistral SSE → OpenAI SSE
// ============================================================
function streamResponse(mistralResp, model, streamOptions = {}) {
  const encoder = new TextEncoder();
  const reader = mistralResp.body.getReader();
  const decoder = new TextDecoder();

  let conversationId = '';
  let streamingModel = model;
  let roleSent = false;
  let createdAt = Math.floor(Date.now() / 1000);
  // 跟踪每个 output_index 的 function call 是否已发送过 id/name
  const functionCallStarted = new Set();
  // Track if we've sent any tool execution content
  let hasToolExecution = false;
  let hasFunctionCall = false;

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      const emit = (obj) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const handleEvent = (eventType, dataLine) => {
        if (!dataLine) return;
        let data;
        try { data = JSON.parse(dataLine); } catch { return; }

        if (eventType === 'conversation.response.started') {
          conversationId = data.conversation_id || conversationId;
          createdAt = data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt;
          emit({
            id: conversationId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: streamingModel,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          });
          roleSent = true;
        } else if (eventType === 'conversation.response.error') {
          // Emit error as a chunk
          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: streamingModel,
            choices: [{
              index: 0,
              delta: { content: `[Error: ${data.message || 'Unknown error'}]` },
              finish_reason: null,
            }],
          });
        } else if (eventType === 'message.output.delta') {
          if (data.content === undefined) return;

          // Update model if available
          if (data.model) streamingModel = data.model;

          // Handle content that could be string, array, or single object
          let contentText = '';
          let contentArr = [];
          if (typeof data.content === 'string') {
            contentText = data.content;
          } else {
            // Normalize to array: single object → [object]
            contentArr = Array.isArray(data.content) ? data.content : [data.content];
            for (const chunk of contentArr) {
              if (chunk.type === 'text' && chunk.text) {
                contentText += chunk.text;
              } else if (chunk.type === 'tool_reference') {
                const title = chunk.title || chunk.tool;
                contentText += chunk.url ? `[${title}](${chunk.url})` : `[${title}]`;
              } else if (chunk.type === 'tool_file') {
                contentText += `[File: ${chunk.file_name || chunk.file_id}]`;
              } else if (chunk.type === 'image_url') {
                const imgUrl = typeof chunk.image_url === 'string' ? chunk.image_url : chunk.image_url?.url || '';
                contentText += imgUrl ? `![image](${imgUrl})` : '[image]';
              } else if (chunk.type === 'document_url') {
                contentText += `[Document: ${chunk.document_name || chunk.document_url}]`;
              } else if (chunk.type === 'thinking' && Array.isArray(chunk.thinking)) {
                // Emit thinking content as reasoning_content deltas
                for (const t of chunk.thinking) {
                  if (t.text) {
                    emit({
                      id: conversationId || `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
                      model: streamingModel,
                      choices: [{
                        index: data.output_index ?? 0,
                        delta: { reasoning_content: t.text },
                        finish_reason: null,
                      }],
                    });
                  }
                }
              }
            }
          }

          if (contentText) {
            emit({
              id: conversationId || `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
              model: streamingModel,
              choices: [{
                index: data.output_index ?? 0,
                delta: { content: contentText },
                finish_reason: null,
              }],
            });
          }
        } else if (eventType === 'function.call.delta') {
          hasFunctionCall = true;
          const idx = data.output_index ?? 0;
          const key = `${idx}:${data.tool_call_id}`;
          const isFirst = !functionCallStarted.has(key);
          if (isFirst) functionCallStarted.add(key);

          const toolCall = {
            index: idx,
            id: data.tool_call_id,
            type: 'function',
            function: {
              name: isFirst ? (data.name || '') : '',
              arguments: data.arguments || '',
            },
          };

          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
            model: streamingModel,
            choices: [{
              index: idx,
              delta: { tool_calls: [toolCall] },
              finish_reason: null,
            }],
          });
        } else if (eventType === 'tool.execution.started') {
          hasToolExecution = true;
          if (data.model) streamingModel = data.model;
          // Optionally emit a notification chunk
          const toolName = data.name || 'tool';
          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
            model: streamingModel,
            choices: [{
              index: data.output_index ?? 0,
              delta: { content: `\n[${toolName} started]\n` },
              finish_reason: null,
            }],
          });
        } else if (eventType === 'tool.execution.delta') {
          // Tool execution delta (e.g., search results streaming in)
          const toolName = data.name || 'tool';
          const args = data.arguments || '';
          if (args) {
            emit({
              id: conversationId || `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
              model: streamingModel,
              choices: [{
                index: data.output_index ?? 0,
                delta: { content: args },
                finish_reason: null,
              }],
            });
          }
        } else if (eventType === 'tool.execution.done') {
          // Tool execution completed — format the result
          const toolName = data.name || 'tool';
          const info = data.info || {};
          const resultText = formatToolExecutionResult(toolName, info, '');
          if (resultText) {
            emit({
              id: conversationId || `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
              model: streamingModel,
              choices: [{
                index: data.output_index ?? 0,
                delta: { content: `\n${resultText}\n` },
                finish_reason: null,
              }],
            });
          }
        } else if (eventType === 'agent.handoff.started') {
          // Agent handoff — emit as content notification
          const agentName = data.previous_agent_name || 'unknown';
          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
            model: streamingModel,
            choices: [{
              index: data.output_index ?? 0,
              delta: { content: `\n[Handing off from ${agentName}...]\n` },
              finish_reason: null,
            }],
          });
        } else if (eventType === 'agent.handoff.done') {
          const agentName = data.next_agent_name || 'unknown';
          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
            model: streamingModel,
            choices: [{
              index: data.output_index ?? 0,
              delta: { content: `\n[Now talking to ${agentName}]\n` },
              finish_reason: null,
            }],
          });
        } else if (eventType === 'conversation.response.done') {
          const finishReason = hasFunctionCall ? 'tool_calls' : 'stop';
          // Respect stream_options.include_usage (default: true for compatibility)
          // When false, OpenAI clients don't expect usage in the final chunk
          const includeUsage = streamOptions.include_usage !== false;
          const doneChunk = {
            id: conversationId,
            object: 'chat.completion.chunk',
            created: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : createdAt,
            model: streamingModel,
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          };
          if (includeUsage) {
            doneChunk.usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          }
          emit(doneChunk);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = block.split('\n');
            let eventType = '', dataLine = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
            }
            handleEvent(eventType, dataLine);
          }
        }

        // 处理末尾残留
        const rest = buffer.trim();
        if (rest) {
          const lines = rest.split('\n');
          let eventType = '', dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
          }
          handleEvent(eventType, dataLine);
        }

        if (!roleSent) {
          emit({
            id: conversationId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: streamingModel,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          });
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ============================================================
//  透传辅助函数：用于 /v1/models 等已兼容 OpenAI 格式的 GET/POST 接口
// ============================================================
async function proxyPassThrough(request, apiKey, targetUrl) {
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
      },
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
    });

    const respHeaders = new Headers();
    const ct = upstream.headers.get('Content-Type');
    if (ct) respHeaders.set('Content-Type', ct);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed: ' + err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
