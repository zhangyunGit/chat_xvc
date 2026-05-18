阶段 1：基础工程闭环

  - 完成 Git 首次提交与远程推送。
  - 保持 Cloudflare 资源脚本可复现：D1、R2、KV、Vectorize、Workers AI。
  - 补齐 .dev.vars.example、部署说明、Secret 配置说明。
  - 保持当前 Worker 首页、/api/health、/api/chat 可部署可验证。

  阶段 2：后端基础架构

  - 重构 src/index.ts，拆分路由、服务、工具层。
  - 引入 Hono 或保持 Workers Fetch API，但建立清晰目录结构。
  - 实现统一响应、错误处理、SSE 流式输出工具。
  - 建立 LLMProvider 抽象，默认接 Workers AI。
  - 建立 EmbeddingProvider 抽象，默认接 Workers AI embedding。

  阶段 3：用户资料与对话持久化

  - 实现用户识别机制，先用简单 userId 或浏览器本地 ID。
  - 完成用户姓名、邮箱、AI 昵称的收集和修改。
  - 对话写入 D1：conversations、messages。
  - 让 AI 后续能正确称呼用户。
  - 把当前聊天 API 从临时回复升级为可持久化对话。

  阶段 4：任务管理工具

  - 实现任务 CRUD API 和 D1 操作。
  - 实现任务需求 task_requirements 的增删改查。
  - 实现自然语言任务操作工具，例如 create_task、update_task、list_tasks。
  - 让 AI 通过工具调用完成任务管理，而不是只生成文本。
  - 支持信息不完整时追问，例如缺少标题、时间、任务归属。

  阶段 5：Intent Router 与动态 Prompt

  - 实现细粒度意图识别：用户资料、任务创建、任务查询、文件问答、搜索研究、普通聊天等。
  - 定义 intent registry。
  - 为不同 intent 绑定工具集合和 Prompt 模板。
  - 对低置信度意图执行澄清追问。
  - 这是项目的核心 Agent 可控性模块。

  阶段 6：正式前端

  - 引入 React + Vite + TypeScript。
  - 将当前 src/ui.ts 临时页面替换为正式前端构建产物。
  - 按 skills/frontend-design/SKILL.md 设计“edge-native AI workspace”。
  - 实现聊天界面、流式输出、用户资料状态、任务侧栏。
  - 保持 Worker 托管前端和 API 的部署方式可运行。

  阶段 7：文件上传与 R2

  - 实现文件上传 API。
  - 原始文件写入 R2。
  - 文件元数据写入 D1。
  - 前端实现文件上传、列表、删除、状态展示。
  - 支持 TXT / Markdown 先行，PDF / Word 后续逐步加入。

  阶段 8：RAG 与 Vectorize

  - 实现文件文本解析。
  - 实现 chunk 分块策略。
  - 使用 Workers AI embedding 生成向量。
  - 写入 Vectorize。
  - D1 保存 chunk 元数据和原文片段。
  - 实现 internal_knowledge_search 工具。
  - 聊天时能基于上传文件回答问题。

  阶段 9：外部搜索

  - 配置 SERPER_API_KEY secret。
  - 实现 SearchProvider 抽象。
  - 接入 Serper.dev。
  - 实现 web_search 工具。
  - 加 KV 搜索结果缓存。
  - 普通实时问题可以先搜索再回答。

  阶段 10：深度研究与子代理规划

  - 实现 research.deep_report workflow。
  - 先生成研究计划。
  - 将主题拆成多个子问题。
  - 对每个子问题多轮搜索。
  - 汇总、去重、交叉验证。
  - 输出结构化报告。
  - 在前端展示研究步骤、来源和最终结论。

  阶段 11：记忆系统

  - 从对话中提取长期记忆候选。
  - 用户确认后写入 D1 / Vectorize。
  - 聊天前召回相关用户偏好、历史任务、长期事实。
  - 区分短期上下文、长期记忆、文件 RAG。

  阶段 12：完善与加分项

  - 文件工作区：文件浏览器、上传进度、文件标签。
  - 多模态：图片 OCR、音频转写、视频关键帧可以作为加分项。
  - Tree of Thoughts / Graph of Thoughts：用于深度研究或复杂任务规划展示。
  - 单元测试、集成测试、部署流水线。
  - 完善最终实现说明文档。
