# Chat XVC 架构设计

本文档记录项目的代码分层、目录职责和拆分原则，供后续开发查阅。

## 1. 总体分层

推荐源码结构：

```text
src/
  index.ts
  routes/
  services/
  repositories/
  agents/
  tools/
  providers/
  prompts/
  types/
```

核心原则：

```text
HTTP 入口      → routes
业务流程      → services
数据库/存储   → repositories
AI 决策       → agents
Agent 动作    → tools
模型/外部 API → providers
Prompt 模板   → prompts
类型定义      → types
```

## 2. routes/

`routes/` 负责 HTTP 入口。

它只关心：

- URL 是什么。
- HTTP method 是什么。
- 如何解析 `Request`。
- 如何返回 `Response`。
- 如何处理 headers、status code、SSE 等 HTTP 细节。
- 参数是否合法。
- 应该调用哪个 service。

推荐文件：

```text
routes/chat.ts
routes/tasks.ts
routes/files.ts
routes/health.ts
```

`routes/` 不应该：

- 直接写复杂业务逻辑。
- 直接写 SQL。
- 直接拼复杂 Prompt。
- 直接操作 D1、R2、KV、Vectorize。

示例调用链：

```text
POST /api/chat
  ↓
routes/chat.ts 解析请求
  ↓
services/chat-service.ts 处理业务
  ↓
返回 SSE stream
```

## 3. services/

`services/` 负责业务流程编排，是应用层。

它负责把多个底层能力串起来，例如：

- 读取用户资料。
- 保存用户消息。
- 调用 Intent Router。
- 选择 Agent workflow。
- 调用任务、文件、RAG、搜索等能力。
- 保存 assistant 回复。
- 返回最终结果或流式结果。

推荐文件：

```text
services/chat-service.ts
services/task-service.ts
services/file-service.ts
services/rag-service.ts
services/research-service.ts
services/user-service.ts
services/conversation-service.ts
```

`services/` 可以调用：

- `repositories/`
- `agents/`
- `tools/`
- `providers/`

`services/` 不应该：

- 直接承载 HTTP 细节。
- 分散大量 SQL。
- 绑定到某个具体模型厂商。

示例：

```text
ChatService
  ↓
读取用户资料
  ↓
保存用户消息
  ↓
调用 Intent Router
  ↓
选择 Agent workflow
  ↓
流式返回结果
  ↓
保存 assistant 消息
```

## 4. repositories/

`repositories/` 负责数据访问。

它只关心如何和持久化资源交互：

- Cloudflare D1。
- Cloudflare R2。
- Cloudflare KV。
- Cloudflare Vectorize。

推荐文件：

```text
repositories/user-repository.ts
repositories/task-repository.ts
repositories/conversation-repository.ts
repositories/file-repository.ts
repositories/vector-repository.ts
repositories/cache-repository.ts
```

职责：

- 写 SQL。
- 查询 D1。
- 读写 R2。
- 读写 KV。
- 写入和查询 Vectorize。
- 将数据库结果转换为领域对象。

原则：

- 所有持久化操作都从 `repositories/` 走。
- 不要让 D1/R2/KV/Vectorize 操作散落在 `routes/`、`services/`、`agents/` 或 `tools/` 中。

示例：

```text
taskRepository.createTask(...)
taskRepository.listTasksByUser(...)
conversationRepository.saveMessage(...)
fileRepository.createFileRecord(...)
```

## 5. agents/

`agents/` 负责 Agent 工作流和智能决策。

它关心：

- 当前用户意图是什么。
- 需要哪些工具。
- 应该选择哪个 Prompt。
- 是否需要澄清。
- 是否需要 RAG。
- 是否需要 web search。
- 是否需要深度研究规划。
- 如何协调多步推理。

推荐文件：

```text
agents/intent-router.ts
agents/chat-agent.ts
agents/task-agent.ts
agents/rag-agent.ts
agents/research-agent.ts
agents/memory-agent.ts
```

典型流程：

```text
用户消息
  ↓
IntentRouter
  ↓
TaskAgent / RagAgent / ResearchAgent / ChatAgent
  ↓
调用 tools
  ↓
生成回答
```

`agents/` 不应该：

- 直接写 SQL。
- 直接操作 R2。
- 直接操作 KV。
- 直接操作 Vectorize。

Agent 需要动作能力时，调用 `tools/`。

## 6. tools/

`tools/` 负责 Agent 可调用的动作能力，是 Agent 的工具箱。

推荐文件：

```text
tools/task-tools.ts
tools/profile-tools.ts
tools/rag-tools.ts
tools/search-tools.ts
tools/file-tools.ts
tools/memory-tools.ts
```

典型工具：

```text
create_task
update_task
list_tasks
delete_task
search_user_documents
web_search
save_user_profile
recall_memory
```

工具拆分原则：

- 每个工具表示一个明确动作。
- 工具应该有清晰输入和输出。
- 工具内部可以调用 `services/` 或 `repositories/`。
- 优先调用 `services/`，避免绕开业务规则。

推荐调用链：

```text
TaskAgent
  ↓
createTaskTool
  ↓
TaskService
  ↓
TaskRepository
  ↓
D1
```

## 7. providers/

`providers/` 负责模型和外部 API 适配。

推荐文件：

```text
providers/workers-ai-provider.ts
providers/llm-provider.ts
providers/embedding-provider.ts
providers/serper-provider.ts
```

职责：

- 封装 Workers AI。
- 封装 embedding 模型。
- 封装 Serper.dev。
- 未来可扩展 Gemini、OpenAI、OpenRouter、Tavily、Brave Search 等。

原则：

- 业务代码依赖抽象接口，不直接依赖具体厂商。
- 默认实现使用 Cloudflare Workers AI。
- 搜索默认实现使用 Serper.dev。

示例接口：

```ts
interface LLMProvider {
  chatStream(messages: ChatMessage[]): Promise<ReadableStream>;
  chat(messages: ChatMessage[]): Promise<string>;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}
```

## 8. prompts/

`prompts/` 负责 Prompt 模板。

推荐文件：

```text
prompts/templates.ts
prompts/task-prompts.ts
prompts/rag-prompts.ts
prompts/research-prompts.ts
prompts/profile-prompts.ts
```

原则：

- 不使用一个巨大 Prompt 处理所有场景。
- Prompt 由 Intent Router 根据意图动态选择。
- 不同工作流使用不同模板。

典型模板：

- 用户资料收集模板。
- 任务管理模板。
- 文档 RAG 问答模板。
- 文档任务抽取模板。
- 深度研究模板。
- 普通对话模板。
- 澄清追问模板。

## 9. types/

`types/` 负责共享类型定义。

推荐文件：

```text
types/domain.ts
types/chat.ts
types/intent.ts
types/tools.ts
types/search.ts
```

职责：

- 用户类型。
- 任务类型。
- 对话类型。
- 文件类型。
- Intent 类型。
- Tool 输入输出类型。
- Provider 输入输出类型。

原则：

- 类型应表达领域语义。
- 避免在业务代码里重复定义相似结构。
- Cloudflare `Env` 类型保留在 `worker-configuration.d.ts`。

## 10. 完整调用链示例

### 10.1 创建任务

用户输入：

```text
帮我把明天下午三点检查简历加入任务
```

调用链：

```text
routes/chat.ts
  ↓ 解析请求，建立 SSE
services/chat-service.ts
  ↓ 保存用户消息
agents/intent-router.ts
  ↓ 判断 intent = task.create
agents/task-agent.ts
  ↓ 选择 task prompt，确认字段足够
tools/task-tools.ts
  ↓ create_task
services/task-service.ts
  ↓ 校验任务数据
repositories/task-repository.ts
  ↓ INSERT INTO tasks
Cloudflare D1
```

最终回复：

```text
好的，我已为你创建任务：明天下午 3 点检查简历。
```

### 10.2 文档 RAG

用户输入：

```text
根据我上传的需求文档，总结还没完成的任务
```

调用链：

```text
routes/chat.ts
  ↓
services/chat-service.ts
  ↓
agents/intent-router.ts
  ↓ intent = document.extract_tasks
agents/rag-agent.ts
  ↓
tools/rag-tools.ts
  ↓ search_user_documents
repositories/vector-repository.ts
  ↓ query Vectorize
repositories/file-repository.ts
  ↓ 读取 chunk 原文
agents/rag-agent.ts
  ↓ 拼接 RAG prompt
LLMProvider
  ↓
返回总结 + 询问是否写入任务列表
```

## 11. 第一轮落地结构

第一轮不需要一次性建完所有模块，建议先建立最小可扩展结构：

```text
src/
  index.ts
  routes/
    chat.ts
    health.ts
  services/
    chat-service.ts
    user-service.ts
    conversation-service.ts
  repositories/
    user-repository.ts
    conversation-repository.ts
  agents/
    intent-router.ts
    chat-agent.ts
  tools/
    profile-tools.ts
    task-tools.ts
  providers/
    workers-ai-provider.ts
  prompts/
    templates.ts
  types/
    domain.ts
    intent.ts
```

这样不会过度设计，也能自然扩展到任务、文件、RAG、搜索和研究。

