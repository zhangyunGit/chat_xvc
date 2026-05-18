# Chat XVC 实现说明

本文档简要说明 Chat XVC 的核心实现方案，重点覆盖整体架构、子代理式研究规划、记忆召回、文件 RAG、多模态能力，以及开发过程中遇到的主要挑战和解决方案。

## 1. 整体架构

Chat XVC 是一个部署在 Cloudflare Workers 上的智能对话式任务管理助手。整体采用 Cloudflare-native 架构：

```text
浏览器前端
  ↓
Cloudflare Worker
  ├─ 静态资源托管：React + Vite + TypeScript
  ├─ /api/chat：SSE 流式对话接口
  ├─ Intent Router：意图识别与工作流路由
  ├─ Agent / Service 编排层：任务、文件、RAG、搜索、研究、记忆、多模态
  ├─ LLMProvider：Cloudflare AI Gateway / Workers AI 抽象
  ├─ SearchProvider：Serper.dev 抽象
  └─ Repository：D1 / R2 / KV / Vectorize 持久化访问

Cloudflare D1        用户、任务、会话、消息、文件元数据、chunk、记忆、LLM 日志
Cloudflare R2        上传的原始文件
Cloudflare KV        搜索缓存等轻量状态
Cloudflare Vectorize 文档 chunk、长期记忆、对话片段和阶段摘要向量
Workers AI           BGE-M3 embedding
AI Gateway           Gemini / DeepSeek 等聊天模型路由
Serper.dev           外部公开网页搜索
```

代码按职责拆分：

- `routes/`：HTTP 路由和 SSE 响应。
- `services/`：业务流程编排，例如 `ChatService`、`ResearchService`、`RagService`。
- `agents/`：意图路由、规则路由、LLM 路由。
- `tools/`：Agent 可调用动作，如任务工具、搜索工具。
- `repositories/`：D1、R2、Vectorize 等持久化访问。
- `providers/`：LLM、embedding、搜索 provider 抽象。
- `prompts/`：按 intent 选择动态 prompt。
- `frontend/`：React/Vite 聊天工作区。

主流程为：

```text
用户消息
  → /api/chat
  → 用户资料解析与会话恢复
  → Intent Router
  → 对应 workflow / tool / RAG / search / multimodal
  → LLM 流式生成或工具直返
  → 保存消息与日志
  → 必要时写入长期记忆
```

## 2. 子代理规划的具体实现

深度研究通过 `ResearchService` 实现，核心是一个“规划 - 执行 - 汇总”的子代理式工作流。

```text
ResearchPlanner
  ↓ 生成研究目标和子问题
Search Executor
  ↓ 每个子问题调用 Serper.dev
Step Analyzer
  ↓ 分析每个子问题的搜索结果
ResearchSynthesizer
  ↓ 汇总为结构化研究报告
```

具体实现：

1. `ResearchPlanner` 使用更强的 Gemini Flash 模型，将用户问题拆成最多 5 个子任务，每个子任务包含 `title`、`query`、`rationale`。
2. 每个子任务调用 `SearchTools.webSearch`，通过 `SearchProvider` 抽象访问 Serper.dev。
3. `Step Analyzer` 对每个子任务的搜索结果生成 3-5 条要点，区分事实、推断和信息缺口。
4. `ResearchSynthesizer` 去重全局来源，最多取 20 条来源，生成最终 Markdown 报告。
5. 前端通过 SSE 接收 `researchSteps`、`thinkStart`、`thinkDelta`、`thinkDone` 和最终报告流式内容，展示研究进度、可展开思考过程和参考链接。

为了支持多轮指代，深度研究会接收最近对话上下文。当用户说“帮我对它进行深度研究下”时，服务端会先从最近消息中解析“它”指代的对象，再构造明确研究问题，避免把用户姓名等资料误当成研究对象。

## 3. 记忆召回（RAG）的设计与流程

记忆系统由 D1 + Vectorize 组成：

- D1 `memories` 表保存结构化记忆记录。
- Vectorize 保存记忆文本的 embedding。
- Workers AI `@cf/baai/bge-m3` 负责生成 1024 维向量。

记忆分为三类：

- 显式长期记忆：用户明确说“请记住……”“我的偏好是……”。
- 对话片段记忆：普通聊天完成后，将用户输入和助手回复压缩成轻量片段。
- 阶段摘要记忆：每 10/18/26... 轮对话生成最近 10 轮阶段摘要，相邻摘要重叠 2 轮。

召回流程：

```text
用户输入
  → 生成 query embedding
  → Vectorize 按 userId + type 过滤检索
  → D1 回表读取 active memory
  → 合并 explicit memory / conversation_memory / conversation_summary
  → 注入 prompt 的 memory block
  → LLM 基于当前问题和召回记忆回复
```

删除记忆时采用软删除：

- D1 `status` 标记为 `deleted`。
- Vectorize 删除对应向量。
- 查询时只返回 `active` 记忆。

普通对话还会在向量召回为空且用户提到“刚才/之前/我们讨论”时，回退使用最近对话片段，降低 Vectorize 写入可见性延迟带来的漏召回。

## 4. 文件处理与向量化细节

文件能力覆盖上传、存储、解析、分块、embedding、向量写入、检索、摘要、问答和删除。

上传流程：

```text
前端选择/拖拽/粘贴文件
  → POST /api/files multipart/form-data
  → 原文件写入 R2
  → 文件元数据写入 D1 files
  → ctx.waitUntil 后台解析索引
```

支持格式：

- TXT
- Markdown
- JSON
- CSV
- PDF
- DOCX

暂不支持旧版二进制 `.doc`。

解析与分块：

- PDF 使用 `unpdf` 提取文本。
- DOCX 使用 `fflate` 解压并解析 `word/document.xml`。
- Markdown 会保留标题层级作为 `sectionPath`。
- JSON 会转成路径文本，例如 `path: product.requirements[0].title`。
- CSV 会转成按行描述的文本。
- chunk 大小约 200-350 tokens，overlap 约 50-80 tokens。

向量化：

```text
chunk text
  → Workers AI @cf/baai/bge-m3
  → 1024 维 embedding
  → Vectorize upsert
  → D1 document_chunks 保存 chunk 元数据、原文片段、vector_id
```

RAG 检索：

1. 当前问题生成 embedding。
2. Vectorize 语义召回 topK。
3. D1 取回 chunk 内容。
4. 结合关键词候选做轻量融合排序。
5. 对命中 chunk 做相邻 chunk 扩展。
6. 将片段注入文档问答 prompt。

上传后直接问文档内容时，前端会把本轮上传文件的 `fileId` 附加到聊天消息中。后端识别 `[fileId:...]` 后，会短暂等待文件进入 `indexed` 状态；如果 PDF 等文件仍在解析，会明确提示当前状态，而不是直接空检索。

删除文件时会同步处理：

- 删除 R2 原始文件。
- 删除 D1 `document_chunks`。
- 删除 Vectorize 中对应向量。
- D1 `files.status` 标记为 `deleted`。

## 5. 多模态支持

当前已实现图片、视频关键帧和音频输入。

图片理解 / OCR：

- 前端支持粘贴、拖拽、选择图片。
- 图片以临时 data URL 传入，不写入 R2/D1。
- 后端强制进入图片理解 workflow，不依赖普通意图识别。
- 通过 AI Gateway + Gemini Flash-Lite 处理。
- 日志中只保存脱敏占位，不记录 base64。

视频关键帧理解：

- 前端用 `HTMLVideoElement` + `Canvas` 在浏览器本地抽取关键帧。
- 后端只接收关键帧和时间戳，不上传完整视频。
- 模型基于多张关键帧进行内容理解和 OCR。
- 回复会说明当前判断基于关键帧，而非完整视频播放。

音频转写：

- 支持 MP3、WAV、M4A、AAC、FLAC、OGG、Opus、WebM audio。
- 短音频以内联 base64 方式调用 Gemini 原生 `generateContent`。
- 原始音频不写入 R2/D1，日志只保留脱敏信息。

## 6. 遇到的挑战及解决方案

### 6.1 多轮上下文与意图路由

问题：只看当前消息时，用户说“这个任务”“它”“这篇文档”容易丢失上下文。

解决：

- 每次请求从 D1 读取最近 20 条消息。
- 传给 LLM 的历史消息只保留标准 `role` 和 `content`。
- 任务、研究、文档等 workflow 在服务端增加指代解析和 fileId 优先逻辑。

### 6.2 普通聊天的重复 LLM 调用

问题：意图识别调用一次 LLM，普通聊天最终回复又调用一次 LLM。

权衡后处理：

- 最终保留“意图识别 + 最终回复”两段式，因为最终回复需要多轮上下文、记忆召回和流式输出。
- 移除把最终回复塞进 intent JSON 的短路方案，避免破坏流式体验。

### 6.3 流式输出

问题：早期后端是等 LLM 完整返回后，再手动切 chunk 给前端，看起来是流式但不是真正模型流式。

解决：

- `LLMProvider` 增加 `chatStream`。
- `ChatAgent.respond` 在 provider 支持时直接转发模型 delta。
- `/api/chat` SSE 将 delta 实时推给前端。
- 前端复用已有 delta append 逻辑实时展示。

### 6.4 PDF 上传后立即问答

问题：TXT 索引很快，PDF 解析较慢。上传后立刻问“这篇 PDF 讲了什么”时，可能还未 indexed，或者被误判成文件列表意图。

解决：

- 规则路由识别带 `[fileId:...]` 的 PDF 内容问题。
- `document.qa` 和 `document.summarize` 对本轮上传文件短暂等待 indexed。
- 如果仍未完成，明确提示文件当前状态。

### 6.5 Cloudflare Workers 无状态环境

问题：不能依赖单个 Worker 实例内存保存会话上下文，请求可能落到不同 isolate。

解决：

- D1 作为对话和消息的权威存储。
- 每次请求按 conversationId 从 D1 获取最近消息。
- 长期上下文通过 D1 + Vectorize 的记忆系统补充。

### 6.6 文件删除与后台索引并发

问题：用户删除文件时，后台 `waitUntil` 索引任务可能还在执行，存在已删除文件重新写入向量或 chunk 的风险。

解决：

- 文件删除先标记 `deleted`。
- 索引写入前后检查文件状态。
- 如果索引期间文件被删除，回滚新写入向量并中止。

### 6.7 Provider 差异

问题：Gemini 原生 API、OpenAI-compatible API、Workers AI 的请求格式不同。

解决：

- 文本对话统一走 `LLMProvider`。
- 默认通过 Cloudflare AI Gateway OpenAI-compatible `/chat/completions` 访问 Gemini。
- 音频转写使用 Gemini 原生 `generateContent`，因为当前音频以内联媒体输入处理更直接。
- 业务层不直接绑定具体模型厂商格式。
