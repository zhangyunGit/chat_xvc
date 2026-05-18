# Intent Router 设计

本文档记录阶段 5「细粒度意图识别与动态 Prompt 模板选择」的设计方案，供后续开发查阅。

阶段 5 的目标是把当前“关键词规则识别任务”的方式，升级成正式的：

```text
Intent Router + 动态 Prompt + 工具路由层
```

用户每次输入后，系统先判断：

- 用户想做什么。
- 需要哪些工具。
- 是否需要追问。
- 是否需要 RAG。
- 是否需要外部搜索。
- 是否需要直接执行数据库操作。
- 应该使用哪个 Prompt 模板。

## 1. 细粒度意图列表

### 1.1 用户资料类

```text
profile.collect_user_info
profile.update_user_info
profile.update_ai_nickname
profile.reset
profile.query
```

示例：

```text
我叫张云，邮箱是 4797@qq.com
我的邮箱改成 xxx@qq.com
以后叫你小智
重新开始
我的邮箱是什么？
```

### 1.2 任务管理类

```text
task.create
task.list
task.detail
task.update
task.complete
task.delete
task.add_requirement
task.update_requirement
task.delete_requirement
task.extract_from_text
```

示例：

```text
帮我创建任务：明天下午三点检查简历
查看我的任务
检查简历这个任务有什么要求？
把检查简历改成明天晚上八点
完成检查简历
删除检查简历
给检查简历加一条要求：重点检查项目经历
修改检查简历的第一条要求
从这段文字里提取任务
```

### 1.3 文件与 RAG 类

```text
document.upload_help
document.list
document.delete
document.search
document.summarize
document.qa
document.extract_tasks
document.compare
```

示例：

```text
我怎么上传文件？
列出我上传的文件
删除上周上传的需求文档
根据我上传的文档回答问题
总结这个 PRD
从文档里提取待办事项
比较这两个文档的差异
```

### 1.4 记忆类

```text
memory.write
memory.recall
memory.delete
memory.list
```

示例：

```text
记住我喜欢简洁的回答
你还记得我的偏好吗？
忘掉我之前说的邮箱
列出你记住了哪些关于我的信息
```

### 1.5 外部搜索与研究类

```text
research.quick_search
research.deep_report
research.compare_options
research.fact_check
research.latest_info
```

示例：

```text
查一下 Cloudflare Vectorize 最新用法
帮我调研 Workers AI 和 OpenAI API 的区别
对比一下 Qdrant 和 Vectorize
帮我核实这条新闻是否属实
最近 Gemini 有什么新模型？
```

### 1.6 普通对话与控制类

```text
conversation.chitchat
conversation.clarify
conversation.general_qa
conversation.help
conversation.capability_intro
```

`conversation.chitchat` 用于处理除任务管理、文件管理、记忆管理、深度研究以外的其他日常或反思型对话，例如兴趣爱好、情感、工作、理想、问候和普通闲聊。

示例：

```text
你好
你能做什么？
这是什么意思？
帮我解释一下 RAG
我刚刚说的是哪个任务？
```

## 2. Intent Router 输出结构

推荐类型：

```ts
type IntentDecision = {
  intent: IntentName;
  confidence: number;
  entities: Record<string, unknown>;
  requiredTools: string[];
  promptTemplate: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  needsRag: boolean;
  needsWebSearch: boolean;
  shouldWriteMemory: boolean;
};
```

任务创建示例：

```json
{
  "intent": "task.create",
  "confidence": 0.94,
  "entities": {
    "title": "检查简历",
    "dueAt": "明天下午三点",
    "priority": "medium"
  },
  "requiredTools": ["create_task"],
  "promptTemplate": "task_manager",
  "needsClarification": false,
  "needsRag": false,
  "needsWebSearch": false,
  "shouldWriteMemory": false
}
```

信息不完整示例：

```json
{
  "intent": "task.create",
  "confidence": 0.81,
  "entities": {
    "title": null,
    "dueAt": "明天下午三点"
  },
  "requiredTools": [],
  "promptTemplate": "clarification",
  "needsClarification": true,
  "clarificationQuestion": "你想创建的任务标题是什么？"
}
```

## 3. 实现方式

Intent Router 分三层实现，而不是全部依赖 LLM。

### 3.1 第一层：Rule Router

用于高置信、低成本、确定性强的场景：

```text
重新开始
查看任务
完成任务
删除任务
邮箱/姓名提取
AI 昵称修改
```

当前已有一部分规则：

```text
src/tools/profile-tools.ts
src/tools/task-command-parser.ts
```

阶段 5 会将这些能力统一收口到：

```text
src/agents/rule-intent-router.ts
```

规则层优点：

- 稳定。
- 快。
- 不消耗模型调用。
- 适合确定性强的操作。

### 3.2 第二层：LLM Intent Classifier

当规则不能确定时，调用 Workers AI 做结构化分类。

新增文件建议：

```text
src/agents/llm-intent-router.ts
src/prompts/intent-router-prompt.ts
```

Prompt 思路：

```text
你是 Intent Router。
请根据用户输入，在给定 intent registry 中选择最合适的意图。
只输出 JSON，不要输出解释。
如果信息不足，设置 needsClarification=true。
```

输入示例：

```json
{
  "userProfile": {
    "name": "张云",
    "email": "xxx@qq.com"
  },
  "message": "把检查简历改成明天晚上八点",
  "availableIntents": ["task.update", "task.complete", "task.create"]
}
```

输出示例：

```json
{
  "intent": "task.update",
  "confidence": 0.9,
  "entities": {
    "target": "检查简历",
    "dueAt": "明天晚上八点"
  },
  "requiredTools": ["update_task"]
}
```

### 3.3 第三层：Fallback Clarifier

如果规则和 LLM 都不确定：

```text
confidence < 0.65
```

则不盲目执行工具，而是追问：

```text
你是想创建一个新任务，还是修改已有任务？
```

这样避免误删任务、误改资料。

## 4. 动态 Prompt 模板选择

Intent Router 不只是分类，还会决定 Prompt 模板。

映射示例：

```text
task.create                  → task_manager_prompt
document.qa                  → rag_answer_prompt
research.deep_report         → deep_research_prompt
profile.collect_user_info    → onboarding_prompt
conversation.general_qa      → general_chat_prompt
conversation.clarify         → clarification_prompt
```

推荐文件：

```text
src/prompts/templates.ts
src/prompts/intent-router-prompt.ts
src/prompts/task-prompts.ts
src/prompts/rag-prompts.ts
src/prompts/research-prompts.ts
src/prompts/profile-prompts.ts
```

## 5. 工具调用映射

阶段 5 会建立工具注册表：

```ts
const toolRegistry = {
  create_task,
  update_task,
  delete_task,
  list_tasks,
  add_task_requirement,
  search_user_documents,
  web_search,
  save_user_profile,
  reset_profile
};
```

Intent Router 输出：

```json
{
  "requiredTools": ["create_task"]
}
```

Agent Orchestrator 执行：

```text
requiredTools
  ↓
toolRegistry
  ↓
execute tool
  ↓
format result
  ↓
return response
```

## 6. 第一版落地顺序

### 6.1 定义 Intent 类型和注册表

新增：

```text
src/types/intent.ts
src/agents/intent-registry.ts
```

内容：

- 全部 intent 名称。
- intent 描述。
- 需要的工具。
- 默认 prompt 模板。
- 是否可执行写操作。
- 是否需要二次确认。

### 6.2 抽出现有规则

把当前分散在：

```text
src/tools/profile-tools.ts
src/tools/task-command-parser.ts
```

中的规则整合到：

```text
src/agents/rule-intent-router.ts
```

规则命中高置信意图时，不调用 LLM。

### 6.3 实现 LLM Intent Router

新增：

```text
src/agents/llm-intent-router.ts
src/prompts/intent-router-prompt.ts
```

用于规则未命中或低置信时调用模型分类。

### 6.4 实现统一 Intent Router

新增：

```text
src/agents/intent-router.ts
```

逻辑：

```text
先跑 rule router
如果 confidence >= 0.85，直接使用
否则跑 LLM router
如果 LLM confidence 低，进入 clarification
```

### 6.5 接入 ChatService

当前 ChatService：

```text
profile collection
  ↓
task parser
  ↓
LLM chat
```

阶段 5 改成：

```text
profile resolution
  ↓
IntentRouter
  ↓
AgentOrchestrator
  ↓
Tool execution / LLM response
  ↓
persist messages
```

## 7. 阶段 5 完成后的效果

当前：

```text
用户输入 → 规则判断任务 → 任务工具 / 普通 LLM
```

升级后：

```text
用户输入
  ↓
规则 + LLM 意图识别
  ↓
动态 Prompt
  ↓
工具注册表
  ↓
澄清 / 执行 / RAG / 搜索 / 普通回答
```

最终目标是让简单高置信请求走规则，复杂表达走 LLM 结构化分类，低置信请求追问澄清，并根据 intent 选择合适工具和 Prompt。
