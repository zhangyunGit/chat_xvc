# 文件功能开发进度与后续规划

本文档用于在新 Codex session 中快速恢复上下文。当前文件功能开发分支为：

```text
file
```

## 0. 当前结论

文件功能的主链路已经完成并部署：用户可以在对话框中点击、拖拽或粘贴文件，系统会保存原文件、写入元数据、解析并切片，使用 BGE-M3 生成向量写入 Vectorize，并支持文件列表、文档检索、文档问答、文档摘要和文件删除闭环。

当前最重要的能力边界：

- 已支持格式：TXT、Markdown、JSON、CSV、PDF、DOCX。
- 暂不支持旧版二进制 `.doc` 文件解析，用户应上传 `.docx`。
- 摘要当前读取单文件前 24 个 chunk，适合中短文档；长文档需要后续做分层摘要。
- 检索已做向量召回、关键词融合和相邻 chunk 扩展；尚未做 reranker 和 parent section 扩展。

当前建议的下一步优先级：

1. 长文档分层摘要 / map-reduce 摘要。
2. RAG parent section 上下文扩展。
3. reranker 二阶段重排。
4. 文档任务抽取和文档比较能力；这两项当前产品上暂不急。

## 1. 当前线上状态

最近一次部署已经把文件上传、索引、检索、删除、PDF/DOCX 解析和摘要联动能力部署到线上：

```text
https://chat-xvc.yun007x.workers.dev
```

部署版本：

```text
e1862f21-027c-4d2a-9b61-9c027fdaeb0b
```

线上已完成烟测：

- `GET /api/health` 正常。
- `POST /api/files` 上传临时小文件成功。
- `GET /api/files?userId=smoke_user` 能读取刚上传文件的 D1 元数据。
- 说明 R2 原始文件写入 + D1 文件元数据持久化链路已打通。
- 已创建 Vectorize index：`chat-xvc-documents-m3`，维度 `1024`，metric `cosine`。
- 已应用远端 D1 migration：`0005_document_indexing.sql`。
- 已部署 BGE-M3 文档索引版本，上传测试文件 `FILE_FEATURE_PROGRESS.md` 后状态从 `uploaded` 变为 `indexed`。
- 远端 D1 烟测确认 `document_chunks` 为测试文件写入 19 个 chunk，`embedding_model` 为 `@cf/baai/bge-m3`。
- 已部署文档检索与问答版本。
- 远端 `document.search` 烟测：`在文档里搜索 Vectorize 维度` 能返回 `ui.sources` 来源片段。
- 远端 `document.qa` 烟测：`根据文档回答：Vectorize 维度是多少？` 能基于 `FILE_FEATURE_PROGRESS.md` 回答 `1024`。
- 已部署文件删除闭环版本。
- 远端删除烟测：上传测试文件到 `smoke_delete` / `smoke_delete_2`，索引后调用 `DELETE /api/files/{fileId}?userId=...`，列表为空，D1 `files.status = deleted`，`document_chunks` 计数为 0。
- 已加入删除与后台索引并发保护：`deleted` 状态不会被 `waitUntil` 索引任务覆盖，索引写入前后会检查文件是否已删除。
- 已部署 RAG 相邻 chunk 扩展版本。
- 远端相邻 chunk 扩展烟测：上传最新版 `FILE_FEATURE_PROGRESS.md` 到 `smoke_expand`，提问“文件删除闭环是否已经完成？删除会处理哪些内容？”，回答能结合 `2.6 文件删除`、`6.4 文件删除` 和线上状态片段说明删除闭环已完成。
- 已部署 PDF/DOCX 解析和文件卡片显式删除按钮版本。
- 远端 PDF/DOCX 烟测：上传 `xvc-pdf-test.pdf` 和 `xvc-word-test.docx` 到 `smoke_pdf_word`，两者状态均变为 `indexed`；提问 “PDF 里说 Vectorize dimension 是多少？Word 文档说删除文件需要删除什么？” 能分别回答 `1024`、`R2 / document_chunks / Vectorize 向量`。
- 已修正 `document.delete` 规则：询问“删除什么/需要删除什么”不再误触发删除，会走文档问答。
- 已部署上传文件后直接摘要的联动版本：前端会把本轮上传文件的 `fileId` 附入聊天消息，`document.summarize` 会优先按 `fileId` 定位文件，等待短时间索引完成后读取该文件 chunk 生成摘要。
- 远端摘要烟测：上传 `FILE_FEATURE_PROGRESS.md` 到 `smoke_summary`，消息中携带 `[fileId:1d385a93-9e77-4fa7-a776-29c48a13c080]` 并提问“请总结该文档内容”，状态流进入 `读取文档中`、`生成摘要中`，返回摘要和 `ui.sources` 来源片段。

## 2. 当前已完成能力

### 2.1 后端 API

新增文件：

```text
src/routes/files.ts
src/services/file-service.ts
src/repositories/file-repository.ts
```

新增路由：

```text
POST /api/files
GET  /api/files?userId={userId}
DELETE /api/files/{fileId}?userId={userId}
```

上传行为：

- 请求格式：`multipart/form-data`。
- 字段：
  - `userId`：可选。
  - `files`：可重复。
- 单次最多 12 个文件。
- 单文件最大 25 MB。
- 原始文件写入 Cloudflare R2，binding 为 `FILES`。
- 文件元数据写入 D1 表 `files`。
- R2 key 格式：

```text
users/{userId}/files/{fileId}/{filename}
```

### 2.2 D1 表

`migrations/0001_initial.sql` 中已经包含：

```text
files
document_chunks
```

当前阶段已经使用：

- `files`：保存文件元数据、R2 key、处理状态、content hash、embedding model、索引时间和错误信息。
- `document_chunks`：保存解析后的 chunk 内容、chunk 顺序、section path、字符区间、metadata 和 parent chunk 信息。

`migrations/0005_document_indexing.sql` 已补充文档索引所需字段。

### 2.3 前端上传入口

文件入口已接入真实上传：

- 点击附件按钮选择文件。
- 拖拽文件到输入框。
- 粘贴图片/文件。
- 上传前以附件 chip 形式显示。
- 点击附件 chip 可移除。
- 发送时先上传附件，再发送用户消息。
- 上传成功后会把返回的 `userId` 写入本地 session。

相关文件：

```text
frontend/src/chat/ChatWorkspace.tsx
frontend/src/chat/useSseChat.ts
frontend/src/styles/theme.css
```

### 2.4 文件意图

已增加规则意图：

```text
document.upload_help
document.list
document.search
document.qa
document.summarize
document.delete
```

示例：

```text
怎么上传文件？
我上传了哪些文件？
列出我的文档列表
在文档里搜索 Vectorize 维度
根据文档回答：Vectorize 维度是多少？
请总结该文档内容
删除 FILE_FEATURE_PROGRESS.md 这个文件
```

相关文件：

```text
src/agents/rule-intent-router.ts
src/services/chat-service.ts
```

### 2.5 文件卡片

`document.list` 会返回简短文本摘要，并通过 `ui.files` 渲染文件卡片：

- 文件名
- 文件大小
- 文件状态
- 上传时间

文件卡片已经包含显式删除按钮，并带浏览器确认交互。确认后调用 `DELETE /api/files/{fileId}?userId={userId}`，删除成功后从当前聊天消息中的文件卡片移除。

### 2.6 文件删除

已完成删除闭环：

- API：`DELETE /api/files/{fileId}?userId={userId}`。
- 对话：用户明确提到文件名或文件 id 时，`document.delete` 可触发删除。
- 删除 R2 原始文件。
- 删除 `document_chunks`。
- 删除 Vectorize 对应向量。
- 保留 D1 `files` 元数据，并将 `status` 标记为 `deleted`。
- `GET /api/files` 默认不返回 `deleted` 文件。

### 2.7 文件摘要联动

已完成上传 + 意图识别 + 摘要生成联动：

- 前端发送带附件的消息时，会先上传文件，再把上传结果中的 `fileId` 追加到同一条聊天消息。
- 用户说“请总结该文档内容”“摘要一下这个文档”等请求时，规则路由会识别为 `document.summarize`。
- 摘要目标优先级：
  - 消息中的 `[fileId:...]`。
  - 明确提到的文件名。
  - “该文档/这个文档/刚刚上传的文件”等指代，默认使用当前用户最新上传文件。
- 后端会短轮询等待文件从 `uploaded/processing` 进入 `indexed`；仍未完成时提示稍后再试。
- 当前摘要实现读取同一文件前 24 个 chunk，要求模型只基于文件片段输出整体概括、关键要点和行动项/决策。

### 2.8 文档解析、切片与索引

已完成异步文档处理：

- 上传后通过 `ctx.waitUntil` 后台处理，不阻塞文件上传响应。
- 支持 TXT、Markdown、JSON、CSV、PDF、DOCX 文本提取。
- 使用约 200-350 tokens 的 child chunk，overlap 约 50-80 tokens。
- 使用 Workers AI `@cf/baai/bge-m3` 生成 1024 维 embedding。
- 写入 Vectorize index `chat-xvc-documents-m3`，metric 为 `cosine`。
- 同步写入 D1 `document_chunks`，记录 `userId`、`fileId`、`chunkId`、`filename`、`chunkIndex`、`section_path` 等元数据。
- 文件状态会从 `uploaded` 进入 `processing`，成功后变为 `indexed`，失败后变为 `failed` 并记录 `processing_error`。

### 2.9 RAG 检索与问答

已完成基础 RAG：

- `document.search`：返回检索命中的文件片段和 `ui.sources`。
- `document.qa`：基于检索片段回答问题，要求模型只依据文件内容。
- 向量召回使用 Vectorize。
- 关键词打分补强短 query、数字、文件名、标题和专有词。
- 最终排序融合语义分数和关键词分数。
- 命中 chunk 会扩展相邻 chunk 作为 LLM 上下文，提升答案完整度。

## 3. 当前本地未提交改动范围

当前 `file` 分支包含此前 `ui` 分支的前端改造，以及本阶段文件功能改造。

重点新增/修改：

```text
src/routes/files.ts
src/services/file-service.ts
src/services/document-processing-service.ts
src/services/rag-service.ts
src/services/rag-ranking-service.ts
src/repositories/file-repository.ts
src/repositories/document-chunk-repository.ts
src/repositories/vector-repository.ts
src/agents/rule-intent-router.ts
src/services/chat-service.ts
src/types/chat.ts
src/types/domain.ts
frontend/src/chat/ChatWorkspace.tsx
frontend/src/chat/useSseChat.ts
frontend/src/styles/theme.css
README.md
scripts/bootstrap-new-cloudflare-account.md
scripts/provision-cloudflare.mjs
scripts/test-document-processing.mjs
scripts/test-file-intents.mjs
scripts/test-file-service.mjs
scripts/test-rag-service.mjs
migrations/0005_document_indexing.sql
```

`deepseek_input.png` 是前端输入框参考图，已加入 `.gitignore`，不应提交。

## 4. 已通过验证

本地验证命令：

```bash
npm run typecheck
npm run test:file-service
npm run test:file-intents
npm run test:intent-router
npm run test:document-processing
npm run test:rag-service
npm run build:frontend
npx wrangler deploy --dry-run --config wrangler.generated.jsonc
```

说明：

- `wrangler deploy --dry-run` 可成功读取 assets、打包 Worker，并显示 `env.FILES`、`env.DB` 等 binding。
- dry-run 中出现的 Wrangler log 写入用户目录失败，是本地沙箱权限问题，不影响部署包校验。
- 远端已完成上传、索引、检索、问答、删除、PDF/DOCX 解析和上传后直接摘要的 smoke test。

## 5. 尚未完成的文件/RAG能力

当前已完成“上传 + 元数据持久化 + TXT/Markdown/JSON/CSV/PDF/DOCX 文件索引 + 基础 RAG 检索/问答 + 删除闭环 + RAG 相邻 chunk 扩展 + 文件卡片显式删除按钮 + 上传后直接摘要联动”。

尚未完成：

| 优先级 | 待办 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| P1 | 长文档分层摘要 / map-reduce 摘要 | 未完成 | 当前版本只读取单文件前 24 个 chunk。 |
| P1 | RAG parent section 上下文扩展 | 未完成 | 当前只做相邻 chunk 扩展，尚未按父标题段落聚合上下文。 |
| P2 | reranker 二阶段重排 | 未完成 | 当前先用向量 + 关键词融合排序，后续可接 reranker 提升精排质量。 |
| P2 | 索引状态更细的前端反馈 | 未完成 | 当前显示文件状态，后续可加处理进度、失败原因和重试入口。 |
| P3 | 从文档中提取任务 | 暂缓 | 用户已明确当前阶段暂不需要。 |
| P3 | 文档比较 | 暂缓 | 用户已明确当前阶段暂不需要。 |
| P3 | 旧版二进制 `.doc` 文件解析 | 暂缓 | 当前要求上传 `.docx`。 |

## 6. 下一阶段建议开发顺序

### 6.0 当前阶段已确认方案

当前阶段直接采用：

```text
Embedding 模型：@cf/baai/bge-m3
Vectorize 维度：1024
Vectorize metric：cosine
推荐索引名：chat-xvc-documents-m3
```

选择理由：

- 项目主要面向中文对话和中文/中英混合文档，`bge-m3` 比 `bge-small-en-v1.5` 更适合多语言 RAG。
- Vectorize index 维度创建后不可变，因此应在真正写入生产向量前切到 1024 维。
- 所有 chunk 元数据需要记录 `embedding_model`，后续换模型时可以区分旧向量并重建索引。

切片策略：

```text
向量化 child chunk：约 200-350 tokens
overlap：约 50-80 tokens
召回答案上下文：后续通过 parent section 或相邻 chunk 扩展到约 600-1000 tokens
```

按文件类型处理：

- Markdown：优先按标题结构切，保存 `section_path`。
- TXT：按段落、换行、句子边界切。
- JSON：解析为 `path: ... / value: ...` 的路径化文本后切。
- CSV：保留表头，按行聚合切。

短 query 优化方案：

- 不只依赖向量相似度；后续 RAG 检索会加入关键词打分。
- 关键词打分重点补强短 query、数字、单位、文件名、标题、专有词。
- 初始融合权重建议：语义向量 0.7，关键词 0.3；包含数字/专有标识或极短 query 时关键词权重可提高到 0.45。
- reranker 作为第二阶段增强，当前阶段先预留，不立即实现。

### 6.1 文件解析与分块

已新增：

```text
src/services/document-processing-service.ts
src/repositories/document-chunk-repository.ts
```

已支持：

```text
txt
md
json
csv
pdf
docx
```

旧版二进制 `.doc` 暂不支持。

### 6.2 Embedding 与 Vectorize

已新增抽象：

```text
src/repositories/vector-repository.ts
```

当前项目已有 Workers AI binding 和 Vectorize binding，可先用：

```text
DEFAULT_EMBEDDING_MODEL=@cf/baai/bge-m3
VECTOR_DIMENSIONS=1024
```

写入 Vectorize 时 metadata 至少包含：

```text
userId
fileId
chunkId
filename
chunkIndex
```

### 6.3 RAG 查询

当前 RAG 服务文件：

```text
src/services/rag-service.ts
src/services/rag-ranking-service.ts
```

已实现：

```text
document.search
document.qa
document.summarize
```

当前已完成。

暂缓实现：

```text
document.extract_tasks
document.compare
```

### 6.4 文件删除

删除应同时处理：

- D1 `files.status = deleted`。
- 删除 R2 对象。
- 删除 `document_chunks`。
- 删除 Vectorize 对应向量。

当前已完成。

## 7. 新 Session 接续提示

新 session 可以从以下指令开始：

```text
当前仓库：/Users/pwrd/explore/xvc
当前分支：file
请先读取 AGENTS.md、PROJECT_PLAN.md、FILE_FEATURE_PROGRESS.md。
当前已完成文件上传、PDF/DOCX/TXT/Markdown/JSON/CSV 索引、基础 RAG 检索/问答、文件删除闭环、相邻 chunk 扩展和上传后直接摘要联动。
下一步建议实现长文档分层摘要、RAG parent section 上下文扩展，或文档任务抽取工作流。
```
