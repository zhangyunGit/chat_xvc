# 外部搜索功能开发进度与后续规划

本文档用于在 `search` 分支中记录外部搜索阶段的设计、进展和接续信息。

## 1. 当前阶段目标

在文件/RAG 主链路完成后，开始实现公开互联网搜索能力：

- 通过 Intent Router 识别 `research.*` 意图。
- 使用可替换的 `SearchProvider` 抽象封装外部搜索。
- 默认接入 Serper.dev。
- 将搜索结果交给 LLM 生成实时问答、快速调研、事实核查和对比回答。
- 将外部搜索来源返回前端，和文档 RAG 来源区分展示。
- 使用 Cloudflare KV 缓存搜索结果，减少重复查询成本和延迟。

## 2. 当前已完成能力

### 2.1 分支

已从 `file` 分支切出：

```text
search
```

当前 `search` 分支保留了文件功能阶段所有未提交改动。

### 2.1.1 当前线上部署

已部署到：

```text
https://chat-xvc.yun007x.workers.dev
```

当前 search 阶段部署版本：

```text
46473361-5473-4dd6-8386-9ca6e3670626
```

### 2.2 SearchProvider 抽象

现有抽象：

```text
src/providers/search-provider.ts
src/providers/serper-provider.ts
src/services/search-service.ts
src/tools/search-tools.ts
src/types/search.ts
```

当前实现：

- `SearchProvider.search(query, options)` 支持可选参数。
- `SerperProvider` 默认调用 `https://google.serper.dev/search`。
- 支持 `num`、`gl`、`hl`、`location`。
- `num` 限制在 1-20，避免异常请求。
- 统一归一化 `organic` 和 `news` 结果。

### 2.3 KV 搜索缓存

`SearchService` 已接入 Cloudflare KV：

- 缓存 key：搜索 query + options 的 SHA-256。
- 默认 TTL：15 分钟。
- 空 query 不调用 provider。
- provider 返回空结果时不写缓存。
- 缓存读写失败只记录 warning，不阻断搜索回答。

### 2.4 聊天联动

已有 `research.*` 意图：

```text
research.quick_search
research.deep_report
research.compare_options
research.fact_check
research.latest_info
```

当前行为：

- `needsWebSearch = true` 时，`ChatService` 会调用 `SearchTools.webSearch`。
- 前端输入框选择“智能搜索”时，会在 `/api/chat` 请求中携带 `forceWebSearch: true`。
- 后端收到 `forceWebSearch` 后会跳过普通意图竞争，直接构造 `research.quick_search`；如果用户文本包含“最新/最近/实时/今天/当前/现在”，则构造 `research.latest_info`。
- 搜索状态通过 SSE 返回 `external_search / 外部搜索中`。
- 搜索结果进入 `deep_research` prompt。
- LLM 回答要求基于搜索结果，区分事实、推断和建议。
- 搜索来源通过 `ui.webResults` 返回前端。
- 搜索 provider 报错时不再静默降级，会直接回复“外部搜索暂时不可用”，并给出可读原因。

### 2.5 前端来源展示

已新增外部搜索来源卡片：

- 和文档 RAG 来源共用紧凑来源列表布局。
- 外部来源使用蓝色信号样式，文档来源保留绿色文档样式。
- 点击来源卡片可在新标签页打开原始链接。

相关文件：

```text
frontend/src/chat/useSseChat.ts
frontend/src/chat/ChatWorkspace.tsx
frontend/src/styles/theme.css
```

### 2.6 Prompt

`src/prompts/research-prompts.ts` 已补充来源字段：

- 标题
- URL
- 来源站点
- 摘要
- 日期

## 3. 配置要求

Serper.dev API Key 必须作为 Worker secret 配置：

```bash
export SERPER_API_KEY="your-serper-api-key"
npm run cf:sync-secrets
```

不要把 `SERPER_API_KEY` 写入仓库文件。

## 4. 已通过验证

本地验证命令：

```bash
npm run test:serper-provider
npm run test:search-service
npm run test:prompt-service
npm run test:intent-router
npm run typecheck
npm run build:frontend
```

当前已验证：

- Serper provider 请求 endpoint、header、body 和结果归一化。
- 缺少 `SERPER_API_KEY` 时会明确报错。
- SearchService 会命中 KV 缓存，并跳过空 query。
- 搜索失败回复会明确说明“外部搜索暂时不可用”、原因和重试建议。
- research prompt 会包含搜索结果和来源。
- 研究类意图仍能被规则路由识别。
- 前端构建通过。
- 远端 smoke test 已通过：用户 `smoke_search` 提问“查一下 Cloudflare Workers 最新信息”，SSE 返回 `external_search / 外部搜索中`、`model_thinking / 输入中`、`ui.webResults` 8 条来源，并生成带来源列表的回答。
- 远端智能搜索 smoke test 已通过：用户 `smoke_force_search_2` 发送 `forceWebSearch: true` 和“Cloudflare Workers KV 定价”，即使消息不含“搜索/最新”等显式触发词，也返回 `external_search / 外部搜索中`、`ui.webResults` 8 条来源，并基于搜索结果回答。

## 5. 当前待办

| 优先级 | 待办 | 说明 |
| --- | --- | --- |
| P1 | 深度研究多轮搜索 | 当前每次 research 只执行一次搜索；深度报告应拆解子问题并多轮检索。 |
| P2 | 搜索结果去重与质量过滤 | 按 domain、标题、URL 去重，过滤低质量片段。 |
| P2 | 搜索结果引用编号约束 | 让模型用稳定编号引用来源，减少含糊引用。 |
| P2 | 搜索缓存调试信息 | 可在开发模式中暴露 cache hit/miss，生产不展示。 |

## 6. 新 Session 接续提示

```text
当前仓库：/Users/pwrd/explore/xvc
当前分支：search
请先读取 AGENTS.md、PROJECT_PLAN.md、FILE_FEATURE_PROGRESS.md、SEARCH_FEATURE_PROGRESS.md。
当前已完成外部搜索第一阶段：SerperProvider、KV 缓存、research 意图联动、智能搜索强制路由、搜索失败显式提示、前端 webResults 来源卡片、本地测试、线上部署和远端 smoke test。
下一步建议实现深度研究多轮搜索、搜索结果去重与质量过滤。
```
