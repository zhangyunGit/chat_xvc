# 深度研究功能开发进度与后续规划

本文档用于在 `research` 分支中记录深度研究和逻辑子代理规划的实现进展。

## 1. 当前阶段目标

在外部搜索第一阶段基础上，实现深度研究工作流：

- `research.deep_report` 不再只做单次搜索，而是先规划、再多轮搜索、再汇总。
- 总分总结构：
  - 总：ResearchPlanner 使用更强模型规划研究。
  - 分：每个子任务搜索和分析使用原 flash 模型。
  - 总：ResearchSynthesizer 使用更强模型汇总报告。
- 执行过程中通过 SSE 持续推送研究步骤和状态。
- 前端使用自定义步骤列表展示子任务进度。
- 规划和汇总的大模型 thinking 内容使用 ChatUI Think 展示，并可折叠。
- Planner 和 Synthesizer 的可展示研究思路支持流式输出：后端推送 `thinkStart`、`thinkDelta`、`thinkDone`，前端实时 append 到 ChatUI Think。

## 2. 当前已完成能力

### 2.1 分支

已从 `search` 分支切出：

```text
research
```

当前 `research` 分支保留了文件/RAG/搜索阶段所有未提交改动。

### 2.1.1 当前线上部署

已部署到：

```text
https://chat-xvc.yun007x.workers.dev
```

当前 research 阶段部署版本：

```text
084d6896-6dd3-4fbd-8927-9f07d2cec41f
```

### 2.2 AI Gateway 模型配置

已在 Wrangler vars 中增加：

```text
DEEPSEEK_PRO_MODEL=deepseek-v4-pro[1m]
GEMINI_CHAT_MODEL=gemini-3-flash-preview
GEMINI_LITE_MODEL=gemini-3.1-flash-lite
GEMINI_PRO_MODEL=gemini-3.1-pro-preview
```

仍复用已有 secret：

```text
DEEPSEEK_API_KEY
GEMINI_API_KEY
```

`AiGatewayProvider` 已支持单次调用覆盖 provider/model：

- 默认 chat：`DEFAULT_CHAT_PROVIDER=google-ai-studio`，`DEFAULT_CHAT_MODEL=gemini-3.1-flash-lite`。
- Planner：配置使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview`。
- 子任务分析：配置使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview`。
- Synthesizer：配置使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview`。

### 2.3 ResearchService

新增：

```text
src/services/research-service.ts
```

当前工作流：

1. `ResearchPlanner`
   - 输入用户研究问题。
   - 配置使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview`。
   - 输出 JSON：thinking、objective、steps。
   - 最多拆 5 个子任务。

2. `ResearchExecutor`
   - 对每个子任务调用 `SearchTools.webSearch`。
   - 每个子任务最多取 6 条搜索结果。
   - 搜索失败不会中断全局流程，会标记对应 step 为 `fail`。

3. `Step Analyzer`
   - 对每个子任务的搜索结果使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview` 分析。
   - 输出 3-5 条要点，强调事实、推断和信息缺口。

4. `ResearchSynthesizer`
   - 全局来源去重，最多给汇总模型 20 条来源。
   - 配置使用 `GEMINI_CHAT_MODEL=gemini-3-flash-preview`。
   - 输出 JSON：thinking、report。
   - 最终报告要求包含结论摘要、分主题分析、关键对比或事实核查、信息局限、来源列表。

### 2.4 SSE 和前端 UI

`/api/chat` 已支持工作流中途推送 `ui` 事件。

新增 UI payload 和请求字段：

```text
researchSteps
thinks
thinkStart
thinkDelta
thinkDone
forceDeepResearch
```

前端已接入：

```text
frontend/src/chat/useSseChat.ts
frontend/src/chat/ChatWorkspace.tsx
frontend/src/styles/theme.css
```

展示方式：

- `researchSteps` 使用自定义步骤列表展示，状态包括 pending、active、success、fail。
- Planner 和 Synthesizer 的 thinking 用 ChatUI `Think` 展示，可展开/收起。
- Think 内容不再必须等待规划/汇总完成后整段展示；AI Gateway 支持 stream 时会实时更新。
- Think 流式 delta 只提取模型 JSON 中的 `thinking` 字符串字段，避免把 `objective`、`steps`、`report` 等结构化内容提前展示到思考面板。
- 深度研究消息按真实执行流程自上而下展示：规划 Think、规划结果、子任务进度、汇总 Think、最终报告、参考网页链接。
- 聊天内容在消息、Think delta、步骤状态和最终回答更新时会自动滚动到底部，方便持续看到最新进展。
- 子任务进度默认保留两行摘要；点击任一子任务可展开完整标题、搜索 query 和分析摘要，再次点击收起。
- Think 面板内容使用 ChatUI `Bubble` 承载，并限制内容区高度，长思考可在面板内滚动，也可通过 Think 原生 toggle 收起。
- 输入框选择“深度思考”会随请求发送 `forceDeepResearch=true`，后端直接命中 `research.deep_report`。
- 如果“深度思考”和“智能搜索”同时开启，后端优先执行深度研究。
- 外部参考链接默认只显示 3 条，剩余链接通过“显示剩余 n 条参考链接”按钮展开。
- 搜索来源继续用 `webResults` 外部来源卡片展示。

### 2.5 ChatService 联动

`research.deep_report` 现在走 `ResearchService.runDeepResearch`。

其他搜索意图目前仍沿用单次搜索流程：

```text
research.quick_search
research.latest_info
research.compare_options
research.fact_check
```

后续可逐步把 compare/fact_check 接入同一个 ResearchService。

## 3. 已通过验证

本地验证命令：

```bash
npm run test:research-service
npm run test:ai-gateway-provider
npm run test:search-service
npm run test:serper-provider
npm run test:prompt-service
npm run typecheck
npm run build:frontend
```

已验证：

- Planner、子任务分析和 Synthesizer 使用 `google-ai-studio/gemini-3-flash-preview`。
- 每个计划子任务会触发一次搜索。
- ResearchService 会推送 active/success step UI 更新。
- 会返回 planner 和 synthesis 两段 thinking。
- 前端构建通过。
- 远端 smoke test 已通过：用户 `smoke_research_2` 提问“帮我深度调研 Cloudflare Workers 和 Vercel Edge Functions 的差异，重点看成本、冷启动、生态和适用场景。”，SSE 返回规划 thinking、5 个 researchSteps、逐个子任务搜索/分析状态、汇总 thinking、18 条去重后的 `webResults` 和最终深度研究报告。
- 首次远端 smoke 暴露 DeepSeek provider 不接受 `[1m]` 后缀；已增加 Gateway 模型名规范化，配置仍保留 `DEEPSEEK_PRO_MODEL=deepseek-v4-pro[1m]`，实际请求使用 `deepseek/deepseek-v4-pro`。
- 用户测试暴露 `AI Gateway response did not contain assistant text (deepseek/deepseek/deepseek-v4-pro)`；已修复已带 provider 前缀模型名的重复拼接，并兼容 `reasoning_content` fallback。远端 `smoke_research_fix` deep report 已通过。
- 已实现可展示 thinking 流式输出：`AiGatewayProvider.chatStream` 解析 OpenAI-compatible SSE，`ResearchService` 在 Planner/Synthesizer 阶段推送 `thinkStart`、`thinkDelta`、`thinkDone`。
- 已修复 Think 流式输出混入 JSON/report 片段的问题：服务端按字段增量提取 `thinking`，最终仍保留完整模型 JSON 用于计划和汇总解析。远端 `smoke_think_field` SSE 抽样未再出现 `steps`、`report`、`objective` 字段。
- 已修复规划结果布局问题：标题和搜索 query 现在位于同一个内容列，不再出现 query 只显示一个字加省略号的情况。
- 已验证输入框“深度思考”开关链路：前端发送 `forceDeepResearch=true`，后端跳过普通意图识别并直接创建 `research.deep_report` 决策。
- 已验证参考链接折叠交互：默认展示 3 条，剩余通过“显示剩余 n 条参考链接”按钮展开。
- 最近一次线上部署版本为 `084d6896-6dd3-4fbd-8927-9f07d2cec41f`，部署后首页引用资源已更新为 `index-B3y80qft.js` 和 `index-CsSxVKo4.css`。

## 4. 当前待办

| 优先级 | 待办 | 说明 |
| --- | --- | --- |
| P1 | 大模型 JSON 容错增强 | 当前已有 JSON 提取 fallback，后续可加 repair prompt。 |
| P1 | 研究报告来源引用校验 | 防止最终报告引用不存在的来源编号。 |
| P1 | 执行耗时优化 | 远端 deep report 约分钟级，应限制默认子任务数或引入并发/超时。 |
| P1 | Think 原始推理边界 | DeepSeek 流里可能有 `reasoning_content`，当前只展示可公开 thinking 字段；后续若要调整，需明确安全边界和产品文案。 |
| P2 | compare/fact_check 专用结构 | 比较类输出对比表，事实核查输出结论等级。 |
| P2 | 搜索结果质量过滤 | 过滤低质量 SEO 页面、重复 mirror、过旧来源。 |
| P2 | 并发搜索 | 当前为顺序执行，后续可对多个子任务并发搜索并限制总超时。 |

## 5. 新 Session 接续提示

```text
当前仓库：/Users/pwrd/explore/xvc
当前分支：research
请先读取 AGENTS.md、PROJECT_PLAN.md、FILE_FEATURE_PROGRESS.md、SEARCH_FEATURE_PROGRESS.md、RESEARCH_FEATURE_PROGRESS.md。
当前已完成深度研究第一阶段：Gemini Flash 模型规划、Gemini Flash 子任务分析、Gemini Flash 模型汇总、SSE 进度、字段级过滤的 Think 流式思考展示、真实流程顺序渲染、子任务点击展开、参考链接默认 3 条折叠、输入框“深度思考”强制命中 deep research、本地测试、线上部署和远端 smoke test。
线上版本：084d6896-6dd3-4fbd-8927-9f07d2cec41f。
下一步建议优化深度研究执行耗时、增加报告来源引用校验，并逐步把 compare/fact_check 接入 ResearchService。
```
