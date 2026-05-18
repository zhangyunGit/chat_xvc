# 记忆系统功能开发进度与后续规划

本文档用于在 `memory` 分支中记录长期记忆系统的实现进展。

## 1. 当前阶段目标

第一阶段先实现用户可控的长期记忆闭环，并增加一层轻量的“对话阶段摘要 + 重要片段”召回：

- 显式写入：用户明确说“记住……”“我的偏好是……”时写入长期记忆。
- 对话片段写入：普通问答/闲聊完成后，将用户输入和助手回复压缩成对话片段记忆。
- 阶段摘要写入：每 10 轮对话生成一条阶段 summary；后续每隔 8 轮再生成一条，形成相邻摘要 2 轮重叠。
- 语义召回：普通对话前按当前 query 同时召回显式长期记忆、即时对话片段和阶段摘要，并注入 prompt。
- 记忆管理：支持列出、查询和删除已保存记忆。
- 存储保持 Cloudflare-native：D1 保存结构化记录，Vectorize 保存语义向量。

暂不做复杂事实抽取和冲突合并。

## 2. 当前已完成能力

### 2.1 分支

已从 `research` 分支切出：

```text
memory
```

当前 `memory` 分支保留了文件/RAG/搜索/深度研究阶段所有未提交改动。

### 2.1.1 当前线上部署

已部署到：

```text
https://chat-xvc.yun007x.workers.dev
```

当前 memory 阶段部署版本：

```text
06ee03f3-b087-4157-a339-f622b4c8b55c
```

### 2.2 D1 Schema

新增迁移：

```text
migrations/0006_memories.sql
```

新增表：

```text
memories
```

主要字段：

- `id`
- `user_id`
- `content`
- `kind`: `preference | fact | instruction | project_context | conversation | conversation_summary | other`
- `vector_id`
- `source_message_id`
- `confidence`
- `status`: `active | deleted`
- `embedding_model`
- `created_at`
- `updated_at`

新增索引：

- `idx_memories_user_status`
- `idx_memories_vector_id`
- `idx_memories_user_kind`

### 2.2.1 LLM 链路日志

新增迁移：

```text
migrations/0007_llm_log_trace_fields.sql
```

`llm_call_logs` 保留原有字段，并新增：

- `request_id`: 单次 `/api/chat` 请求的链路 ID，SSE `meta` 事件会返回。
- `conversation_id`
- `stage`: 例如 `intent.rule`、`intent.llm`、`reply.general`、`research.plan`、`memory.stage_summary`。
- `intent`
- `provider`
- `status`
- `duration_ms`
- `error_text`

日志开关：

```text
LLM_LOGGING_ENABLED=true
```

设置为 `false`、`0`、`off`、`no` 或 `disabled` 时跳过写入 `llm_call_logs`。

### 2.3 Vectorize

第一阶段复用现有 Vectorize index：

```text
chat-xvc-documents-m3
```

记忆向量 id 规则：

```text
memory:{memoryId}
```

记忆向量 metadata：

```text
type=memory
userId
memoryId
kind
status=active
embeddingModel
```

对话片段向量 id 规则：

```text
cmem:{memoryId}
```

对话片段向量 metadata：

```text
type=conversation_memory
userId
memoryId
kind=conversation
status=active
embeddingModel
```

阶段摘要向量 id 规则：

```text
csum:{memoryId}
```

阶段摘要向量 metadata：

```text
type=conversation_summary
userId
memoryId
kind=conversation_summary
status=active
embeddingModel
```

文档向量后续写入会带 `type=document`，但 RAG 查询仍兼容历史未带 type 的文档向量。

### 2.4 服务与仓储

新增：

```text
src/repositories/memory-repository.ts
src/services/memory-service.ts
```

`MemoryService` 当前能力：

- `writeMemory`: 提取显式记忆内容、分类、生成 BGE-M3 embedding、写 D1、upsert Vectorize。
- `writeConversationMemory`: 将普通问答/闲聊的用户输入和助手回复压缩为“对话片段”，写入 D1，并以 `type=conversation_memory` 写入 Vectorize。
- `writeConversationSummaryMemory`: 将 LLM 生成的阶段摘要写入 D1，并以 `type=conversation_summary` 写入 Vectorize；向量基于 summary 文本，而不是原始 10 轮对话。
- `recall`: 对 query 生成 embedding，默认按 `type=memory` 检索；普通对话可同时按 `type=memory`、`type=conversation_memory` 与 `type=conversation_summary` 检索，合并排序、去重后回 D1 获取 active 记忆。
- `listMemories`: 列出用户 active 记忆。
- `deleteMemories`: 先做文本包含匹配，并会剥离“关于/的/偏好/内容/记忆”等泛词；找不到时用语义召回删除最相关的一条；D1 软删除，Vectorize 删除向量。

### 2.5 Intent 和 ChatService 联动

已有 intent：

```text
memory.write
memory.recall
memory.delete
memory.list
```

本阶段已接入：

- RuleIntentRouter 识别显式记忆写入、查询、列表、删除。
- Intent Router prompt 增加 memory intent 判定规则。
- ChatService 对 `memory.*` intent 调用 `MemoryService`。
- 普通 `conversation.general_qa` 和 `conversation.chitchat` 会先召回 top 6 相关长期记忆、即时对话片段与阶段摘要，并注入 prompt。
- 普通 `conversation.general_qa` 和 `conversation.chitchat` 完成回复后，会沉淀一条轻量对话片段记忆；记忆管理、文件、任务、搜索、深度研究等工具型流程暂不自动写入对话片段。
- 每个会话在第 10、18、26... 个完整助手回复保存后，会对最近 10 轮生成一条阶段摘要；相邻两条摘要重叠 2 轮。
- 显式 `memory.recall` 会同时检索 `type=memory`、`type=conversation_memory` 与 `type=conversation_summary`；命中后将召回内容交给 LLM 生成自然回答，如果语义召回未命中，会回退使用当前 active 记忆列表，避免用户已有记忆但得不到任何结果。
- 普通对话遇到“刚才/之前/我们讨论”这类追问且向量召回为空时，会回退注入最近的对话片段，降低 Vectorize 写入可见性延迟或意图边界导致的漏召回。

当前用户可用表达示例：

```text
请记住：我喜欢简洁的回答
我的偏好是先给结论再解释
你现在都记住了什么？
你还记得我的回答风格吗？
忘记关于简洁回答的偏好
```

### 2.6 记忆管理 API

新增路由：

```text
GET /api/memories?userId={userId}
DELETE /api/memories/{memoryId}?userId={userId}
```

当前能力：

- 列出用户 active memories。
- 按 memory id 删除单条记忆。
- 删除会同步 D1 软删除和 Vectorize 向量删除。

### 2.7 记忆管理 UI

前端新增 Chat header 中的“记忆”入口。

交互：

- 打开长期记忆面板。
- 刷新记忆列表。
- 查看记忆分类、内容和更新时间。
- 删除单条记忆，删除前用浏览器确认。
- 空状态提示用户如何写入第一条记忆。

### 2.8 Prompt 注入

`createPromptMessages` 已支持 `memories`：

```text
长期记忆、相关对话片段与阶段摘要（仅在相关时使用，不要主动暴露内部分数）：
1. [preference] 我喜欢简洁的回答
2. [conversation] 对话片段：用户：... 助手：...
3. [conversation_summary] 阶段摘要（第 1-10 轮，窗口 10 轮，与上一阶段重叠 2 轮）：...
```

记忆只作为上下文增强，不作为用户可见的内部检索分数展示。

## 3. 已通过验证

本地验证命令：

```bash
npm run test:memory-service
npm run test:memory-route
npm run test:intent-router
npm run test:prompt-service
npm run test:rag-service
npm run typecheck
npm run build:frontend
```

已验证：

- 显式记忆内容提取。
- 记忆类型分类。
- D1 写入 active memory。
- Vectorize upsert 带 `type=memory` metadata。
- 语义召回时带 `type=memory` 和 `status=active` 过滤。
- 对话片段写入会使用 `kind=conversation` 和 `type=conversation_memory` metadata。
- 阶段摘要写入会使用 `kind=conversation_summary` 和 `type=conversation_summary` metadata。
- 普通对话召回可同时检索 `type=memory`、`type=conversation_memory` 与 `type=conversation_summary`，并对重复向量 id 去重。
- 记忆列表返回 active memories。
- 删除记忆会 D1 软删除并删除 Vectorize 向量。
- `/api/memories` 支持列表和按 id 删除。
- 前端记忆面板构建通过。
- RuleIntentRouter 能识别 `memory.write`、`memory.list`、`memory.delete`。
- 线上 smoke 暴露 Vectorize id 最大 64 bytes；已将记忆向量 id 从 `memory:{userId}:{memoryId}` 改为 `memory:{memoryId}`，用户隔离继续通过 metadata 和 D1 user_id 实现。
- PromptService 能正常构建带长期记忆块的系统 prompt。
- RAG 测试仍通过，说明 VectorRepository filter 扩展未破坏文档检索。

远端验证：

- 已执行远端 D1 migration：`0006_memories.sql`。
- 已部署 Worker：`5c401a82-98b4-4b11-a885-b68189dd9503`。
- 线上 smoke 用户：`smoke_memory_20260516b`。
- 写入通过：`请记住：我喜欢先给结论再解释。` 返回“我已记住……”。
- 列表通过：`你现在都记住了什么？` 返回 active memory。
- 召回回退通过：`你还记得我的回答风格吗？` 在语义未精确命中时回退展示 active memory。
- 删除通过：`忘记关于先给结论的偏好` 返回“我已忘记这些内容……”。
- 删除后列表通过：再次列表返回“我还没有保存任何长期记忆。”。
- 记忆管理 UI/API 部署版本：`5128d1bb-a6db-4cbc-ab44-c81dcb642be6`。
- 线上管理 API smoke 用户：`smoke_memory_ui_20260516`。
- `/api/memories?userId=...` 列表通过，返回刚写入的记忆。
- `DELETE /api/memories/{memoryId}?userId=...` 删除通过，删除后列表为空。
- 首页已引用最新前端资源：`index-Dju7obE2.js` 和 `index-bzpOV04O.css`。
- 对话片段记忆部署版本：`638a473b-0ad0-4273-b08f-6a36183df1c7`。
- 线上对话片段 smoke 用户：`smoke_conversation_memory_20260516c`。
- 普通对话写入通过：`/api/memories?userId=...` 返回 `kind=conversation` 的对话片段，内容包含 `Atlas Cost Map` 和“追踪边缘节点成本”。
- 追问召回通过：`我们刚才提到的项目叫什么？它的目标是什么？` 进入“记忆工具执行中”和“基于记忆回答中”，并回答项目名 `Atlas Cost Map` 及目标。
- 阶段摘要记忆部署版本：`06ee03f3-b087-4157-a339-f622b4c8b55c`。
- 线上阶段摘要 smoke 用户：`smoke_stage_summary_20260517c`。
- 使用同一个 `conversationId` 连续完成 10 轮普通问答后，`/api/memories?userId=...` 返回 `kind=conversation_summary` 的阶段摘要。
- 阶段摘要内容带有窗口标识：`阶段摘要（第 1-10 轮，窗口 10 轮，与上一阶段重叠 2 轮）`。

## 4. 当前待办

| 优先级 | 待办 | 说明 |
| --- | --- | --- |
| P1 | 删除确认交互 | 当前语义删除可能删除最相关一条，后续应对低置信度删除先确认。 |
| P1 | 记忆去重 | 写入相似记忆前检查是否已有近似内容。 |
| P2 | 阶段摘要后台化 | 当前第 10/18/26... 轮会同步生成阶段摘要；后续可通过 `ctx.waitUntil` 后台化，减少当轮响应延迟。 |
| P2 | 自动抽取候选记忆 | 从普通对话中识别“值得长期记住”的候选，但需要用户确认。 |
| P2 | 记忆冲突处理 | 新旧偏好冲突时更新旧记忆而不是新增。 |
| P2 | 记忆 UI 细化 | 后续可增加分类筛选、搜索和批量删除。 |

## 5. 新 Session 接续提示

```text
当前仓库：/Users/pwrd/explore/xvc
当前分支：memory
请先读取 AGENTS.md、PROJECT_PLAN.md、FILE_FEATURE_PROGRESS.md、SEARCH_FEATURE_PROGRESS.md、RESEARCH_FEATURE_PROGRESS.md、MEMORY_FEATURE_PROGRESS.md。
当前已完成记忆系统第一阶段：D1 memories schema、MemoryRepository、MemoryService、显式写入/召回/列表/删除、普通对话 prompt 注入相关记忆、即时对话片段记忆写入与 Vectorize 召回、每 10 轮且 2 轮重叠的阶段摘要记忆、记忆管理 API、记忆管理 UI、本地测试、远端 D1 migration、线上部署和 smoke test。
线上版本：06ee03f3-b087-4157-a339-f622b4c8b55c。
下一步建议补删除确认、记忆去重、阶段摘要后台化和记忆管理 UI 筛选。
```
