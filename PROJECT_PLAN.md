# 智能对话式任务管理助手：需求与最终方案

## 1. 项目目标

基于 Cloudflare Workers 开发一个可公开访问的智能对话式任务管理助手，重点展示 AI Agent 的工程落地能力，包括：

- 工具调用
- 用户与任务管理
- 对话记忆
- 文件上传与 RAG
- 外部实时搜索
- 子代理式研究规划
- 图片理解、OCR、视频关键帧理解与音频转写
- 流式回答
- Cloudflare 边缘部署

最终交付物包括源代码、公开访问 URL、部署说明和实现说明文档。

## 2. 核心需求

### 2.1 基础对话与用户管理

- 提供网页对话界面。
- 当用户未提供姓名和邮箱时，AI 主动询问并保存。
- 后续对话中能够正确称呼用户。
- 用户可以设置和修改 AI 昵称。
- AI 回答需要支持流式输出。

### 2.2 任务管理

- 用户通过自然语言增删改查任务。
- 用户可以通过对话维护任务的详细需求。
- 不使用传统表单作为主要交互方式。
- 所有任务操作通过 Agent 工具调用完成，并写入数据库。

### 2.3 外部搜索与深度研究

- 接入外部搜索 API，优先使用 Serper.dev。
- 支持实时信息检索。
- 对复杂研究主题，Agent 需要先拆解计划，再执行多轮搜索，并整合为结构化报告。
- 搜索工具需要封装为 `SearchProvider`，方便未来替换为 Tavily、Brave Search、Bing Search API 等服务。

### 2.4 文件处理与 RAG

- 支持用户上传 PDF、Word、TXT、Markdown 等文件。
- 原始文件存储到 Cloudflare R2。
- 文件元数据、chunk 元数据存储到 Cloudflare D1。
- 文本解析后进行分块、embedding，并写入 Cloudflare Vectorize。
- 后续对话通过语义检索召回相关片段，作为上下文增强 LLM 回答。
- 支持文件的增删改查。

### 2.5 数据持久化

- Cloudflare D1：用户、任务、对话记录、文件元数据、chunk 元数据。
- 长期记忆：D1 保存显式记忆、即时对话片段和阶段摘要记录，Vectorize 保存对应语义向量。
- Cloudflare R2：上传的原始文件。
- Cloudflare KV：轻量缓存、会话状态、搜索结果缓存。
- Cloudflare Vectorize：文档 chunk 向量和长期记忆向量。

### 2.6 多模态输入

- 支持用户在聊天输入框中粘贴或拖入图片，并同时输入文字要求。
- 当请求包含图片时，自动进入图片理解/OCR 工作流，不依赖用户显式选择意图。
- 图片以本次请求的临时 data URL 传入多模态模型，不作为普通文件写入 R2/D1；对话记录和 LLM 日志只保存图片元数据与脱敏占位。
- 支持用户拖入视频后在浏览器本地抽取关键帧，再把关键帧和时间戳作为多图输入交给模型；第一阶段不上传完整视频、不处理音频。
- 支持用户上传音频后自动转写成文字；第一阶段使用短音频 inline 请求，不把原始音频写入 R2/D1。
- 图片理解/OCR 默认通过 AI Gateway 调用 Google AI Studio `gemini-3.1-flash-lite`，音频转写通过 Gemini `generateContent` inline audio 能力调用同一模型，继续复用现有 `GEMINI_API_KEY`。

## 3. 最终技术选型

本项目优先采用 Cloudflare-native 架构，以最大化边缘部署收益。

| 模块 | 选型 |
| --- | --- |
| 运行环境 | Cloudflare Workers |
| 前端 | Worker 托管静态页面或后续接入前端框架 |
| 后端框架 | TypeScript + Hono 或 Workers 原生 Fetch API |
| 关系数据库 | Cloudflare D1 |
| 对象存储 | Cloudflare R2 |
| 缓存/轻量状态 | Cloudflare KV |
| 向量数据库 | Cloudflare Vectorize |
| LLM | Cloudflare AI Gateway，默认 DeepSeek |
| Embedding | Cloudflare Workers AI embedding 模型 |
| 外部搜索 | Serper.dev |
| AI 观测/治理 | 可选 Cloudflare AI Gateway |

## 3.1 前端技术选型与风格要求

当前项目已经包含一个最小可运行的 Worker 内嵌网页，用于验证 Cloudflare Workers 首页访问、`/api/chat` 流式输出和 Workers AI 调用。

正式前端技术选型定为：

```text
React + Vite + TypeScript
```

选择理由：

- 与 Cloudflare Workers 生态兼容好。
- 构建产物可作为静态资源由 Worker 托管，后续也可迁移到 Cloudflare Pages。
- 适合实现聊天界面、任务工作区、文件管理、上传进度、RAG 片段展示和研究报告阅读体验。
- 相比 Next.js 更轻量，避免过早引入与 Worker 运行时相关的复杂适配。
- 比长期维护纯 HTML/CSS 更适合项目后续扩展。

前端目录建议：

```text
apps/web        React + Vite + TypeScript 前端
src             Cloudflare Worker API 与服务端逻辑
```

在正式前端接入前，`src/ui.ts` 仅作为临时演示 UI，后续可被 React/Vite 构建产物替换。

### 前端风格要求

本项目新增项目内前端设计 skill：

```text
skills/frontend-design/SKILL.md
```

任何 UI、页面、组件、聊天界面、上传工作区、任务面板、RAG 结果展示、研究报告页面或 React/Vite 前端任务，都应遵循该 skill。

整体风格方向：

- 打造 polished 的 “edge-native AI workspace”。
- 以聊天为核心，但支持任务、文件、记忆、检索和研究报告的工作区体验。
- 视觉上体现 Cloudflare 边缘网络、知识检索、文档记忆和 Agent 编排等概念。
- 避免泛泛的 AI SaaS 风格，例如默认紫色渐变、普通卡片堆叠、缺少层次的 dashboard。
- 需要有明确设计方向、统一设计 token、响应式布局、可访问性、状态设计和细节动效。

前端实现原则：

- 使用 CSS variables 管理颜色、间距、圆角、阴影、动效等设计 token。
- 优先保证可读性、速度、键盘可用性和移动端体验。
- 所有 UI 改动必须保持 Cloudflare Workers 部署可运行。
- 前端正式化后需要保留当前流式对话能力。

## 4. 关于 Qdrant 与 Vectorize 的决策

Qdrant Cloud 是 Qdrant 提供的独立向量数据库云服务，不属于 Cloudflare。

需求中提到 Qdrant Cloud 免费层，但表述为“如 Qdrant Cloud 免费层等”，因此它是示例而非强制要求。

本项目最终选择 Cloudflare Vectorize，理由：

- 更符合“部署到 Cloudflare 边缘网络”的目标。
- Worker、D1、R2、KV、Vectorize、Workers AI 都在 Cloudflare 体系内，架构更统一。
- 减少外部平台账号、API Key 和跨平台网络调用。
- 足以支持基础 RAG：向量写入、topK 检索、metadata 过滤、文档召回。
- 通过 `VectorStore` 抽象层保留未来替换为 Qdrant 的能力。

## 5. 关于 Workers AI 的决策

聊天 LLM 默认使用 Cloudflare AI Gateway，embedding 继续使用 Cloudflare Workers AI。

原因：

- AI Gateway 提供统一入口、日志、限流、重试和后续 provider 切换能力。
- DeepSeek 默认模型响应速度和能力更适合当前对话任务。
- 降低运维复杂度。
- embedding 仍保持 Cloudflare-native，便于 Vectorize RAG 流程。

但模型能力可能不如 Gemini、OpenAI、Anthropic 等闭源模型，因此需要实现 `LLMProvider` 抽象层：

- 默认实现：AI Gateway + Google AI Studio `google-ai-studio/gemini-3.1-flash-lite`，用于意图识别、普通聊天和多模态理解。
- 深度思考/深度研究实现：AI Gateway + Google AI Studio `google-ai-studio/gemini-3-flash-preview`。
- 备用实现：AI Gateway + DeepSeek `deepseek/deepseek-v4-flash`。
- 保留 Workers AI 作为可切换聊天运行时和默认 embedding provider。
- 支持未来切换模型，不把业务逻辑绑定到单一提供商。

## 6. 关于 Serper.dev 的决策

Serper.dev 是外部独立搜索 API，不属于 Cloudflare。

Cloudflare 有 AI Search、Vectorize、Browser Rendering 等能力，但它们不能完全替代 Google/Bing 类全网实时搜索 API。

本项目中搜索能力分为两类：

- `internal_knowledge_search`：搜索用户上传文件、任务历史、长期记忆，使用 Vectorize。
- `web_search`：搜索公开互联网、新闻和实时资料，使用 Serper.dev。

Serper.dev 需要封装成 `SearchProvider`，未来可替换为其他搜索 API。

## 7. Agent 设计

### 7.1 Intent Router

系统不应使用一个巨大 Prompt 处理所有请求，而应先识别用户意图，再选择对应工作流、工具和 Prompt 模板。

推荐识别的意图包括：

- `profile.collect_user_info`
- `profile.update_ai_nickname`
- `task.create`
- `task.update`
- `task.delete`
- `task.list`
- `task.add_requirement`
- `document.search`
- `document.summarize`
- `document.extract_tasks`
- `research.quick_search`
- `research.deep_report`
- `memory.recall`
- `conversation.chitchat`
- `conversation.clarify`

Intent Router 输出结构应包含：

- `intent`
- `confidence`
- `entities`
- `required_tools`
- `prompt_template`
- `needs_rag`
- `needs_web_search`
- `needs_clarification`

### 7.2 动态 Prompt 模板

根据意图选择不同 Prompt 模板：

- 用户资料收集模板
- 任务管理模板
- 文档 RAG 问答模板
- 文档任务抽取模板
- 深度研究模板
- 普通对话模板
- 澄清追问模板

目标是降低幻觉、减少不必要工具调用，并提升复杂任务可控性。

### 7.3 工具调用

工具应按领域拆分：

- 用户资料工具
- 任务管理工具
- 文件管理工具
- RAG 检索工具
- 外部搜索工具
- 记忆写入和召回工具
- 深度研究规划工具

所有会改变状态的操作必须写入 D1、R2、KV 或 Vectorize。

AI 调用链路日志写入 D1 `llm_call_logs`，用单次请求的 `request_id` 串联规则/LLM 意图识别、回复生成、研究规划/子任务/汇总和记忆阶段摘要等阶段；可通过 `LLM_LOGGING_ENABLED` 开关关闭。

## 8. 推荐系统架构

```text
用户浏览器
  ↓
Cloudflare Worker
  ├─ 静态页面 / 前端入口
  ├─ Chat API：流式对话
  ├─ Intent Router：意图识别
  ├─ Agent Orchestrator：工具调用与工作流编排
  ├─ LLMProvider：AI Gateway，默认 DeepSeek，可切换 Gemini / Workers AI
  ├─ VectorStore：Vectorize，未来可切换
  └─ SearchProvider：Serper.dev，未来可切换

Cloudflare D1
  ├─ users
  ├─ tasks
  ├─ task_requirements
  ├─ conversations
  ├─ messages
  ├─ files
  ├─ document_chunks
  └─ memories

Cloudflare R2
  └─ uploaded files

Cloudflare KV
  ├─ session cache
  └─ search cache

Cloudflare Vectorize
  ├─ document chunks
  ├─ explicit memories
  ├─ conversation snippets
  └─ conversation stage summaries

Serper.dev
  └─ public web search
```

## 9. 开发顺序建议

1. 初始化 Cloudflare Workers TypeScript 项目。
2. 搭建基本网页对话界面和流式 Chat API。
3. 配置 D1 schema，完成用户资料和任务管理。
4. 实现 Workers AI 的 LLMProvider。
5. 实现 Intent Router 和动态 Prompt 模板。
6. 接入 R2 文件上传和文件元数据管理。
7. 实现文件解析、分块、embedding、Vectorize 写入。
8. 实现 RAG 检索和文档问答。
9. 接入 Serper.dev 搜索工具。
10. 实现深度研究工作流和结构化报告。
11. 补充 README、部署说明和实现说明。
12. 部署到 Cloudflare Workers 并记录公开访问地址。

## 10. 需要准备的信息

### Cloudflare

- Cloudflare 账号。
- Account ID。
- 是否使用默认 `workers.dev` 域名或自定义域名。
- 是否允许创建 D1、R2、KV、Vectorize、Workers AI binding。
- 本机通过 Wrangler 登录，推荐使用 `npx wrangler login`。

### 外部搜索

- Serper.dev API Key。

### 代码托管

- GitHub 或 GitLab 仓库地址。
- 是否需要配置 CI/CD。

## 11. 安全原则

- 不把任何 API Key 写入代码仓库。
- 本地开发密钥使用 `.dev.vars`。
- 线上密钥使用 `wrangler secret put` 或 Cloudflare Dashboard Secrets。
- 不提交 `.dev.vars`。
- 不直接暴露 Cloudflare Global API Key。
- 优先使用受限 API Token 或本机 Wrangler 登录。
