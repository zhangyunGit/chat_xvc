# 测试说明与记录

本文档记录当前项目的功能冒烟测试脚本，以及记忆向量召回评估脚本和最近一次评估结果。

## 1. 功能冒烟测试

功能冒烟测试位于 `scripts/feature-*.mjs`。这些脚本面向核心业务流程，不依赖真实 Cloudflare D1、R2、Vectorize 或外部 LLM 服务。脚本会在临时目录中用 `esbuild` 打包对应服务模块，并使用本地 mock 资源执行可重复测试。

### 1.1 统一运行

```bash
npm run test:features
```

该命令依次运行：

```bash
npm run test:feature:tasks
npm run test:feature:files
npm run test:feature:memory
npm run test:feature:research
```

最近一次验证结果：

```text
feature task management ok
feature file management ok
feature memory management ok
feature deep research ok
```

### 1.2 任务管理冒烟测试

脚本：

```text
scripts/feature-task-management.mjs
```

运行：

```bash
npm run test:feature:tasks
```

覆盖范围：

- 创建任务。
- 列出任务。
- 使用 `targetIndex` 按“第几个任务”修改任务。
- 给指定任务补充需求。
- 使用序号完成任务。
- 使用序号删除任务。
- 验证最终任务列表状态。

重点验证的问题：

- 多轮对话中常见的“把第 2 个删除掉”“把第 2 个完成掉”等指代型操作，能够通过 LLM 意图识别结果中的 `targetIndex` 被服务层正确执行。
- 测试使用本地 mock D1，不写真实数据库。

### 1.3 文件管理冒烟测试

脚本：

```text
scripts/feature-file-management.mjs
```

运行：

```bash
npm run test:feature:files
```

覆盖范围：

- 上传 Markdown 文件。
- 写入 mock R2。
- 写入文件元数据。
- 调用文档处理服务解析、切片、生成 embedding、写入 mock Vectorize。
- 列出文件。
- 删除文件。
- 删除时清理 mock R2 对象、document chunk 和向量。

重点验证的问题：

- 文件上传、解析、向量化和删除清理形成闭环。
- 测试使用本地 mock R2、mock D1、mock Vectorize，不写真实 Cloudflare 资源。

### 1.4 记忆管理冒烟测试

脚本：

```text
scripts/feature-memory-management.mjs
```

运行：

```bash
npm run test:feature:memory
```

覆盖范围：

- 显式记忆写入。
- 对话片段记忆写入。
- 显式记忆和对话记忆混合召回。
- 列出记忆。
- 按主题删除记忆。
- 删除时清理对应向量。

重点验证的问题：

- `MemoryService` 的写入、召回、列表和删除流程可正常工作。
- 记忆向量使用 `type=memory`，对话片段使用 `type=conversation_memory`，召回时可按类型过滤。
- 测试使用本地 mock D1 和 mock Vectorize，不写真实资源。

### 1.5 深度研究冒烟测试

脚本：

```text
scripts/feature-deep-research.mjs
```

运行：

```bash
npm run test:feature:research
```

覆盖范围：

- 深度研究 planner 生成研究计划。
- 每个子任务调用 mock web search。
- 每个子任务调用 LLM 分析。
- 最终 synthesis 生成研究报告。
- 流式 thinking UI 事件输出。
- 研究步骤 UI 状态从 pending 到 active/success。
- 指代解析回归：用户说“帮我对它进行深度研究下”时，应从最近上下文解析为“浪潮信息（000977.SZ）”，不能误识别为用户姓名。

重点验证的问题：

- 深度研究 workflow 的 planner、search、step analysis、synthesis 能形成完整链路。
- 测试使用 mock LLM 和 mock fetch，不访问真实搜索服务或模型。

## 2. 记忆召回评估

记忆召回评估脚本：

```text
scripts/eval-memory-retrieval.mjs
```

package 命令：

```bash
npm run eval:memory-retrieval
```

该脚本用于评估当前记忆向量方案的检索效果。它复用项目里的 `MemoryService.recall` 逻辑，但向量索引使用脚本内存 mock，因此不会写入真实 Cloudflare Vectorize，也不会污染 D1 或用户记忆。

### 2.1 数据集

默认数据集：

```text
C-MTEB/EcomRetrieval
C-MTEB/EcomRetrieval-qrels
```

用途：

- `corpus` 作为候选记忆内容。
- `queries` 作为用户查询。
- `qrels` 作为标准答案。

当前脚本支持两种抽样方式：

- `targeted`：先按 qrels 选择 query 和正例文档，再补充随机负例到指定候选规模。默认方式。
- `prefix`：直接读取前 N 条 corpus，再筛选落在候选池内的 qrels。适合快速调试，但可能凑不满指定 query 数。

由于当前环境访问 `datasets-server.huggingface.co` 不稳定，脚本已实现 fallback：当 datasets-server 失败时，自动从 Hugging Face 原始 parquet 文件下载，并通过本地 `pyarrow` 读取。

### 2.2 运行方式

离线 smoke test，不访问 Hugging Face 或 Cloudflare：

```bash
npm run eval:memory-retrieval -- --offline-smoke --queries 4 --candidates 5 --embedding hash --vector-dimensions 256
```

真实小样本评估，使用当前 Cloudflare Workers AI embedding：

```bash
npm run eval:memory-retrieval -- --queries 100 --candidates 3000 --embedding cloudflare
```

Cloudflare embedding 模式需要：

```text
CLOUDFLARE_API_TOKEN
```

`CLOUDFLARE_ACCOUNT_ID` 可以来自环境变量，也可以来自项目根目录 `config.json` 的：

```json
{
  "cloudflare": {
    "account_id": "..."
  }
}
```

### 2.3 最近一次评估配置

执行时间：

```text
2026-05-18
```

配置：

```text
Dataset: C-MTEB/EcomRetrieval
Embedding: cloudflare-workers-ai:@cf/baai/bge-m3
Sampling: targeted qrels positives + random negatives
Candidates: 3000
Evaluated queries: 100
Positive documents included: 100
Random negative documents included: 2900
Full corpus rows loaded locally: 100902
```

说明：

- 这次评估没有写入真实 Vectorize。
- 3000 条候选向量只存在于脚本内存 mock Vectorize 中。
- 进程结束后向量自动消失。
- 结果是 sampled candidate pool 上的指标，不是完整 C-MTEB 官方全量 corpus 指标。

### 2.4 最近一次评估结果

```text
MRR@10:   0.8091
nDCG@10:  0.8407

K=1
Hit@1:       0.7500
Recall@1:    0.7500
Precision@1: 0.7500

K=3
Hit@3:       0.8500
Recall@3:    0.8500
Precision@3: 0.2833

K=5
Hit@5:       0.9100
Recall@5:    0.9100
Precision@5: 0.1820

K=10
Hit@10:       0.9400
Recall@10:    0.9400
Precision@10: 0.0940
```

示例输出：

```text
200115: firstRelevantRank=1 relevant=121065 retrieved=121065,23431,82461,9555,19863
  border饼干
200398: firstRelevantRank=1 relevant=401485 retrieved=401485,1830,27861,23439,95955
  自动喂食器 鱼
200003: firstRelevantRank=1 relevant=4836 retrieved=4836,79557,25167,111,32873
  启辰r50大灯罩
```

### 2.5 指标解释

`Hit@K`：

表示正确记忆是否出现在前 K 条召回结果中。`Hit@5=0.91` 表示 100 个查询中，有 91 个查询的正确记忆进入了前 5 条。

`Recall@K`：

表示所有应召回的正确答案中，有多少比例被前 K 条结果召回。本次评估中每个 query 基本只有 1 个标准答案，因此 `Recall@K` 与 `Hit@K` 数值相同。

`Precision@K`：

表示前 K 条召回结果中有多少比例是真正相关的。本次评估每个 query 基本只有 1 个标准答案，因此 `Precision@5` 的理论上限接近 `1/5=0.2`，`Precision@10` 的理论上限接近 `1/10=0.1`。

`MRR@K`：

Mean Reciprocal Rank，平均倒数排名。它衡量正确答案排得有多靠前。正确答案排第 1 得 1 分，排第 2 得 0.5 分，排第 5 得 0.2 分，前 K 条未命中得 0 分。

`nDCG@K`：

Normalized Discounted Cumulative Gain，归一化折损累计增益。它衡量整体排序质量，正确答案越靠前得分越高，范围通常是 0 到 1，越接近 1 越好。

### 2.6 结果解读

最近一次结果说明：

- 75% 的查询能把正确记忆排在第 1。
- 85% 的查询能把正确记忆排进前 3。
- 91% 的查询能把正确记忆排进前 5。
- 94% 的查询能把正确记忆排进前 10。

对当前记忆召回场景而言，`@cf/baai/bge-m3` 在该中文小样本评估中表现可用。若只取 Top 1 记忆，仍有约 25% 的查询可能漏掉正确记忆；若取 Top 5，命中率提升到约 91%，但会引入更多无关候选。

当前建议：

```text
默认记忆召回 topK = 5
```

后续可进一步引入：

- score threshold，过滤低分记忆。
- rerank，对 Top 10 或 Top 20 做二阶段重排。
- 按记忆类型过滤，例如显式记忆、对话片段、阶段摘要分开召回。
- 召回后压缩和去重，降低无关记忆对最终 LLM 回复的干扰。
