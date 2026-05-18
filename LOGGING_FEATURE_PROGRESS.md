# 日志功能开发进度与使用说明

本文档记录 `llm_call_logs` 链路日志的当前实现、查询方式、开关配置和后续待办。

## 1. 当前目标

日志功能用于还原一次用户请求的完整 AI 调用链路，解决过去 `llm_call_logs` 经常只看到一次 LLM 结果、无法判断问题发生在意图识别还是回复生成的问题。

当前设计原则：

- 单次 `/api/chat` 请求生成一个 `requestId`。
- SSE `meta` 事件返回 `requestId`，便于从前端问题复现直接定位日志。
- 同一次请求内的规则意图、LLM 意图、回复生成、研究规划、子任务分析、汇总、记忆阶段摘要等都使用同一个 `request_id`。
- 规则命中也写日志，避免“没有调用 LLM 就没有链路记录”。
- 可通过环境变量关闭 D1 日志写入。

## 2. D1 Schema

原表：

```text
llm_call_logs
```

新增迁移：

```text
migrations/0007_llm_log_trace_fields.sql
```

新增字段：

- `request_id`: 单次 `/api/chat` 请求的链路 ID。
- `conversation_id`: 当前会话 ID。
- `stage`: 当前链路阶段。
- `intent`: 当前阶段对应的最终或上下文 intent。
- `provider`: `deepseek`、`google-ai-studio`、`workers-ai`、`rule` 等。
- `status`: `success | error | skipped`。
- `duration_ms`: 预留耗时字段。
- `error_text`: 错误阶段的异常摘要。

新增索引：

- `idx_llm_call_logs_request_id`
- `idx_llm_call_logs_conversation_id`
- `idx_llm_call_logs_stage`

## 3. 日志开关

`wrangler.jsonc` 和 `wrangler.generated.jsonc` 当前配置：

```jsonc
"LLM_LOGGING_ENABLED": "true"
```

关闭日志写入可设置为：

```text
false
0
off
no
disabled
```

该开关只控制写入 `llm_call_logs`，不影响 Cloudflare AI Gateway 自身日志。

## 4. 阶段命名

当前常用阶段：

```text
intent.rule
intent.llm
intent.forced_web_search
intent.forced_deep_research
profile.intake
profile.update
reply.general
reply.web_answer
reply.memory_recall
reply.document_summary
reply.document_qa
reply.task_tool_result
reply.task_clarify
research.plan
research.step_analysis.{n}
research.synthesis
memory.stage_summary
intent.error
reply.error
```

说明：

- `intent.rule`: 规则路由命中，`provider=rule`，`model_name=rule`。
- `intent.llm`: 调用 LLM Router 进行意图识别。
- `reply.*`: 最终回复生成或某个业务回复生成阶段。
- `research.*`: 深度研究里的规划、子任务分析、最终汇总。
- `memory.stage_summary`: 每 10/18/26... 轮生成对话阶段摘要时的 LLM 调用。
- `intent.error` / `reply.error`: 意图识别或回复生成抛错时的错误链路记录。

## 5. 查询方式

从前端或 SSE 中拿到 `requestId` 后查询：

```sql
SELECT called_at, request_id, conversation_id, stage, intent, provider, model_name, status
FROM llm_call_logs
WHERE request_id = '...'
ORDER BY called_at, created_at;
```

排查某个会话：

```sql
SELECT called_at, request_id, stage, intent, status, substr(query_text, 1, 80) AS query
FROM llm_call_logs
WHERE conversation_id = '...'
ORDER BY called_at, created_at;
```

查看最近错误：

```sql
SELECT called_at, request_id, stage, intent, error_text
FROM llm_call_logs
WHERE status = 'error'
ORDER BY called_at DESC
LIMIT 20;
```

## 6. 已验证

已执行远端 D1 migration：

```text
0007_llm_log_trace_fields.sql
```

已部署版本：

```text
09a700ad-7a48-4c74-96de-2a4b61e5788a
```

线上 smoke 验证：

- 用户：`smoke_llm_logs_20260517_final`
- 请求返回 `requestId`: `a0e9a7e5-49fd-4042-9cfb-f8ba9f7a3b40`
- D1 查询同一 `request_id` 返回：

```text
profile.intake
intent.llm
reply.general
```

规则路由 smoke：

- 用户：`smoke_llm_logs_20260517_rule`
- 请求：`查看我的任务`
- D1 查询同一 `request_id` 返回：

```text
profile.intake
intent.rule
```

本地验证命令：

```bash
npm run typecheck
npm run test:intent-router
npm run test:research-service
npm run test:prompt-service
npm run test:memory-route
npm run test:rag-service
npm run test:ai-gateway-provider
npm run build:frontend
```

## 7. 当前限制与后续待办

| 优先级 | 待办 | 说明 |
| --- | --- | --- |
| P1 | 记录真实耗时 | 当前 `duration_ms` 字段已预留，但多数阶段还未填入真实耗时。 |
| P1 | 日志查询 API/UI | 当前主要通过 D1 SQL 查询；后续可增加管理 API 或开发面板。 |
| P2 | 精简 prompt 存储 | 当前仍保存完整 prompt JSON，后续可增加截断或脱敏策略。 |
| P2 | 成本统计 | 可基于阶段、模型和 request_id 汇总调用量，后续接入 token usage 时扩展。 |

## 8. 新 Session 接续提示

```text
当前仓库：/Users/pwrd/explore/xvc
当前分支：memory
日志功能已完成 request-level 链路追踪：D1 migration 0007、llm_call_logs 新增 request_id/conversation_id/stage/intent/provider/status/duration_ms/error_text，/api/chat SSE meta 返回 requestId。
日志开关：LLM_LOGGING_ENABLED=true；设置为 false/0/off/no/disabled 可关闭写入。
线上版本：09a700ad-7a48-4c74-96de-2a4b61e5788a。
已验证：同一 request_id 可查到 profile.intake、intent.llm、reply.general；规则路由可查到 intent.rule。
下一步建议：补 duration_ms、日志查询 API/UI、prompt 脱敏/截断。
```
