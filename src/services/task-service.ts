import { TaskRepository } from "../repositories/task-repository";
import { parseTaskCommand, toTaskStatusLabel, type TaskCommand } from "../tools/task-command-parser";
import type { Task, TaskPriority, TaskRequirement, TaskStatus, TaskWithRequirements, UpdateTaskInput } from "../types/domain";
import type { IntentDecision, IntentName, RecentIntentMessage } from "../types/intent";

export type TaskFunctionName =
  | "create_task"
  | "list_tasks"
  | "get_task_detail"
  | "update_task"
  | "delete_task"
  | "add_task_requirement"
  | "update_task_requirement"
  | "delete_task_requirement"
  | "extract_tasks_from_text";

export type TaskExecutionResult = {
  handled: boolean;
  intent?: IntentName;
  functionName?: TaskFunctionName;
  mode?: "direct" | "llm";
  reply?: string;
  toolResultText?: string;
};

type TaskExecutionInput = {
  userId: string;
  message: string;
  decision: IntentDecision;
  recentMessages: RecentIntentMessage[];
};

type TaskResolution = {
  task: TaskWithRequirements | null;
  clarification?: string;
};

export class TaskService {
  private readonly taskRepository: TaskRepository;

  constructor(db: D1Database) {
    this.taskRepository = new TaskRepository(db);
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    const command = parseTaskCommand(input.message);
    const intent = input.decision.intent;

    switch (intent) {
      case "task.create":
        return this.createTask(input, command);
      case "task.list":
        return this.listTasks(input.userId);
      case "task.detail":
        return this.getTaskDetail(input, command);
      case "task.update":
      case "task.complete":
        return this.updateTask(input, command);
      case "task.delete":
        return this.deleteTask(input, command);
      case "task.add_requirement":
        return this.addRequirement(input, command);
      case "task.update_requirement":
        return this.updateRequirement(input, command);
      case "task.delete_requirement":
        return this.deleteRequirement(input, command);
      case "task.extract_from_text":
        return this.extractTasksFromText(input, command);
      default:
        return { handled: false };
    }
  }

  private async createTask(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const title = getEntityString(input.decision.entities, ["title", "taskTitle"]) ??
      (command.type === "create" ? command.title : "");
    const detail = getEntityString(input.decision.entities, ["detail", "description", "taskDetail", "content"]) ??
      (command.type === "create" ? command.detail : input.message);
    const dueAt = getEntityString(input.decision.entities, ["dueAt", "deadline"]) ??
      (command.type === "create" ? command.dueAt : null);
    const priority = getEntityPriority(input.decision.entities) ??
      (command.type === "create" ? command.priority : "medium");

    if (!isMeaningfulTitle(title)) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "create_task",
        toolResultText: "create_task 未执行：缺少必填参数 title。请询问用户要创建的任务标题。"
      });
    }

    const task = await this.taskRepository.createTask({
      userId: input.userId,
      title,
      detail: detail.trim() || title,
      dueAt,
      priority
    });

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "create_task",
      toolResultText: createToolResultText("create_task", "success", {
        task: serializeTask(task)
      })
    });
  }

  private async listTasks(userId: string): Promise<TaskExecutionResult> {
    const tasks = await this.taskRepository.listTasks(userId);

    if (tasks.length === 0) {
      return {
        handled: true,
        intent: "task.list",
        functionName: "list_tasks",
        mode: "direct",
        reply: "你当前还没有任务。你可以直接说“帮我创建任务：检查简历 明天下午3点”。"
      };
    }

    const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
    const completedTasks = tasks.filter((task) => task.status === "done");
    const lines = tasks.map((task, index) => formatTaskLine(task, index + 1));
    const summary = `你当前共有 ${tasks.length} 个任务，其中 ${openTasks.length} 个未完成，${completedTasks.length} 个已完成。`;

    return {
      handled: true,
      intent: "task.list",
      functionName: "list_tasks",
      mode: "direct",
      reply: `${summary}\n${lines.join("\n")}`
    };
  }

  private async getTaskDetail(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const targetIndex = getEntityNumber(input.decision.entities, ["targetIndex", "index"]) ??
      (command.type === "detail" ? command.targetIndex : undefined);
    const resolution = await this.resolveTask(input.userId, target, targetIndex);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "get_task_detail",
        toolResultText: `get_task_detail 未执行：${resolution.clarification ?? "缺少要查询的任务标题或序号。"}`
      });
    }

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "get_task_detail",
      toolResultText: createToolResultText("get_task_detail", "success", {
        task: serializeTaskWithRequirements(resolution.task)
      })
    });
  }

  private async updateTask(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const resolution = await this.resolveTask(input.userId, target);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "update_task",
        toolResultText: `update_task 未执行：${resolution.clarification ?? "缺少要修改的任务标题或序号。"}`
      });
    }

    const patch = createUpdatePatch(input, command);
    if (Object.keys(patch).length === 0) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "update_task",
        toolResultText: `update_task 未执行：已定位任务“${resolution.task.title}”，但缺少要修改的字段。请询问用户要修改标题、具体内容、截止时间、优先级还是状态。`
      });
    }

    const updated = await this.taskRepository.updateTask(input.userId, resolution.task.id, patch);

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "update_task",
      toolResultText: createToolResultText("update_task", "success", {
        before: serializeTask(resolution.task),
        after: serializeTask(updated)
      })
    });
  }

  private async deleteTask(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const resolution = await this.resolveTask(input.userId, target);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "delete_task",
        toolResultText: `delete_task 未执行：${resolution.clarification ?? "缺少要删除的任务标题或序号。"}`
      });
    }

    await this.taskRepository.deleteTask(input.userId, resolution.task.id);

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "delete_task",
      toolResultText: createToolResultText("delete_task", "success", {
        deletedTask: serializeTask(resolution.task)
      })
    });
  }

  private async addRequirement(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const content = getEntityString(input.decision.entities, ["requirement", "requirementContent", "content"]) ??
      (command.type === "add_requirement" ? command.content : "");
    const resolution = await this.resolveTask(input.userId, target);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "add_task_requirement",
        toolResultText: `add_task_requirement 未执行：${resolution.clarification ?? "缺少要添加要求的任务标题或序号。"}`
      });
    }

    if (!content.trim()) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "add_task_requirement",
        toolResultText: `add_task_requirement 未执行：已定位任务“${resolution.task.title}”，但缺少 requirement content。请询问用户要补充什么具体要求。`
      });
    }

    const requirement = await this.taskRepository.addRequirement(resolution.task.id, content.trim());

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "add_task_requirement",
      toolResultText: createToolResultText("add_task_requirement", "success", {
        task: serializeTask(resolution.task),
        requirement: serializeRequirement(requirement)
      })
    });
  }

  private async updateRequirement(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const content = getEntityString(input.decision.entities, ["requirement", "requirementContent", "content"]) ??
      (command.type === "update_requirement" ? command.content : "");
    const resolution = await this.resolveTask(input.userId, target);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "update_task_requirement",
        toolResultText: `update_task_requirement 未执行：${resolution.clarification ?? "缺少要修改要求的任务标题或序号。"}`
      });
    }

    const requirement = resolveRequirement(input.decision.entities, command, resolution.task);
    if (!requirement) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "update_task_requirement",
        toolResultText: `update_task_requirement 未执行：已定位任务“${resolution.task.title}”，但未能唯一定位要修改的要求。当前要求：${formatRequirementsForClarification(resolution.task.requirements)}。请询问用户要修改第几条要求。`
      });
    }

    if (!content.trim()) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "update_task_requirement",
        toolResultText: `update_task_requirement 未执行：已定位任务“${resolution.task.title}”和要求“${requirement.content}”，但缺少新的要求内容。请询问用户要改成什么内容。`
      });
    }

    const updated = await this.taskRepository.updateRequirement(resolution.task.id, requirement.id, content.trim());

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "update_task_requirement",
      toolResultText: createToolResultText("update_task_requirement", "success", {
        task: serializeTask(resolution.task),
        beforeRequirement: serializeRequirement(requirement),
        afterRequirement: serializeRequirement(updated)
      })
    });
  }

  private async deleteRequirement(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const target = getTaskTarget(input, command);
    const resolution = await this.resolveTask(input.userId, target);

    if (!resolution.task) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "delete_task_requirement",
        toolResultText: `delete_task_requirement 未执行：${resolution.clarification ?? "缺少要删除要求的任务标题或序号。"}`
      });
    }

    const requirement = resolveRequirement(input.decision.entities, command, resolution.task);
    if (!requirement) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "delete_task_requirement",
        toolResultText: `delete_task_requirement 未执行：已定位任务“${resolution.task.title}”，但未能唯一定位要删除的要求。当前要求：${formatRequirementsForClarification(resolution.task.requirements)}。请询问用户要删除第几条要求。`
      });
    }

    await this.taskRepository.deleteRequirement(resolution.task.id, requirement.id);

    return createLlmResult({
      intent: input.decision.intent,
      functionName: "delete_task_requirement",
      toolResultText: createToolResultText("delete_task_requirement", "success", {
        task: serializeTask(resolution.task),
        deletedRequirement: serializeRequirement(requirement)
      })
    });
  }

  private async extractTasksFromText(input: TaskExecutionInput, command: TaskCommand): Promise<TaskExecutionResult> {
    const content = getEntityString(input.decision.entities, ["content", "text"]) ??
      (command.type === "extract_from_text" ? command.content : input.message);
    const titles = extractTaskTitles(content);

    if (titles.length === 0) {
      return createLlmResult({
        intent: input.decision.intent,
        functionName: "extract_tasks_from_text",
        toolResultText: "extract_tasks_from_text 未执行：缺少可拆解的任务文本。请让用户粘贴要拆解的内容。"
      });
    }

    const createdTasks = await Promise.all(
      titles.map((title) =>
        this.taskRepository.createTask({
          userId: input.userId,
          title,
          detail: title,
          priority: "medium",
          dueAt: null
        })
      )
    );

    return {
      handled: true,
      intent: input.decision.intent,
      functionName: "extract_tasks_from_text",
      mode: "direct",
      reply: [
        `已从文本中创建 ${createdTasks.length} 个任务：`,
        ...createdTasks.map((task, index) => `${index + 1}. ${formatTaskInline(task)}`)
      ].join("\n")
    };
  }

  private async resolveTask(userId: string, target: string, targetIndex?: number): Promise<TaskResolution> {
    const tasks = await this.taskRepository.listTasks(userId);
    const visibleTasks = tasks.filter((task) => task.status !== "cancelled");

    if (targetIndex !== undefined) {
      const indexedTask = visibleTasks[targetIndex - 1];
      return indexedTask
        ? { task: indexedTask }
        : { task: null, clarification: `没有找到第 ${targetIndex} 个任务。请先查看任务列表并指定正确序号。` };
    }

    const cleanedTarget = target.trim();
    if (cleanedTarget) {
      const task = await this.taskRepository.findTaskWithRequirementsByTitle(userId, cleanedTarget);
      return task
        ? { task }
        : { task: null, clarification: `没有找到匹配“${cleanedTarget}”的任务。请确认任务标题或先查看任务列表。` };
    }

    const openTasks = visibleTasks.filter((task) => task.status !== "done");
    if (openTasks.length === 1) return { task: openTasks[0] };
    if (visibleTasks.length === 1) return { task: visibleTasks[0] };

    if (visibleTasks.length === 0) {
      return { task: null, clarification: "当前没有可操作的任务。请先创建任务。" };
    }

    return {
      task: null,
      clarification: `缺少要操作的任务标题或序号。当前有 ${visibleTasks.length} 个任务：${visibleTasks
        .map((task, index) => `${index + 1}. ${task.title}`)
        .join("；")}。`
    };
  }
}

function createUpdatePatch(input: TaskExecutionInput, command: TaskCommand): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  const entityTitle = getEntityString(input.decision.entities, ["title", "newTitle"]);
  const entityDetail = getEntityString(input.decision.entities, ["detail", "description", "newDetail"]);
  const entityDueAt = getEntityString(input.decision.entities, ["dueAt", "deadline", "newDueAt"]);
  const entityPriority = getEntityPriority(input.decision.entities);
  const entityStatus = getEntityStatus(input.decision.entities);

  if (input.decision.intent === "task.complete") {
    patch.status = "done";
  }

  if (command.type === "complete") {
    patch.status = "done";
  }

  if (command.type === "update") {
    if (command.title !== undefined) patch.title = command.title;
    if (command.dueAt !== undefined) patch.dueAt = command.dueAt;
    if (command.priority !== undefined) patch.priority = command.priority;
    if (command.status !== undefined) patch.status = command.status;
  }

  if (entityTitle) patch.title = entityTitle;
  if (entityDetail) patch.detail = entityDetail;
  if (entityDueAt !== undefined) patch.dueAt = entityDueAt;
  if (entityPriority) patch.priority = entityPriority;
  if (entityStatus) patch.status = entityStatus;

  return patch;
}

function getTaskTarget(input: TaskExecutionInput, command: TaskCommand): string {
  const entityTarget = getEntityString(input.decision.entities, [
    "target",
    "task",
    "taskTitle",
    "taskName",
    "title",
    "id"
  ]);
  if (entityTarget) return normalizeTaskTarget(entityTarget);

  if ("target" in command) {
    const commandTarget = normalizeTaskTarget(command.target);
    if (commandTarget) return commandTarget;
  }

  return inferRecentTaskTarget(input.recentMessages);
}

function normalizeTaskTarget(target: string): string {
  const cleaned = target.trim();
  if (/^(这个|该|当前|刚才|上面|它|其)$/u.test(cleaned)) return "";
  return cleaned;
}

function inferRecentTaskTarget(messages: RecentIntentMessage[]): string {
  const recentAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.intent?.startsWith("task."));

  if (!recentAssistantMessage) return "";

  const content = recentAssistantMessage.content;
  const updatedTitle =
    content.match(/任务标题[\s*：:]*.*?更新为[“"*\s]*([^”"*。\n]+)/u)?.[1] ??
    content.match(/更新为[“"*\s]*([^”"*。\n]+)/u)?.[1];
  if (updatedTitle) return updatedTitle.trim();

  const quotedTitle = content.match(/任务[“"]([^”"]+)[”"]/u)?.[1];
  if (quotedTitle) return quotedTitle.trim();

  const createdTitle = content.match(/创建任务[：:]?\s*([^，,。.!！?？\n]+)/u)?.[1];
  if (createdTitle) return createdTitle.trim();

  const listLines = content
    .split("\n")
    .map((line) => line.match(/^\s*\d+[.、]\s*([^（(]+)/u)?.[1]?.trim())
    .filter((title): title is string => Boolean(title));

  if (listLines.length === 1) return listLines[0];

  return "";
}

function resolveRequirement(
  entities: Record<string, unknown>,
  command: TaskCommand,
  task: TaskWithRequirements
): TaskRequirement | null {
  const requirementId = getEntityString(entities, ["requirementId"]);
  if (requirementId) {
    return task.requirements.find((requirement) => requirement.id === requirementId) ?? null;
  }

  const index = getEntityNumber(entities, ["requirementIndex", "index"]) ??
    (command.type === "update_requirement" || command.type === "delete_requirement"
      ? command.requirementIndex
      : undefined);
  if (index !== undefined) {
    return task.requirements[index - 1] ?? null;
  }

  const target = getEntityString(entities, ["requirementTarget", "oldRequirement"]) ??
    (command.type === "update_requirement" || command.type === "delete_requirement"
      ? command.requirementTarget
      : undefined);
  if (target) {
    return task.requirements.find((requirement) => requirement.content.includes(target)) ?? null;
  }

  if (task.requirements.length === 1) return task.requirements[0];
  return null;
}

function createLlmResult(input: {
  intent: IntentName;
  functionName: TaskFunctionName;
  toolResultText: string;
}): TaskExecutionResult {
  return {
    handled: true,
    intent: input.intent,
    functionName: input.functionName,
    mode: "llm",
    toolResultText: input.toolResultText
  };
}

function createToolResultText(functionName: TaskFunctionName, status: "success", payload: unknown): string {
  return JSON.stringify(
    {
      functionName,
      status,
      payload
    },
    null,
    2
  );
}

function formatTaskInline(task: Task): string {
  const dueAt = task.dueAt ? `，截止时间：${task.dueAt}` : "";
  const priority = task.priority === "medium" ? "" : `，优先级：${formatPriority(task.priority)}`;
  const detail = task.detail ? `，内容：${task.detail}` : "";
  return `${task.title}${detail}${dueAt}${priority}`;
}

function formatTaskLine(task: TaskWithRequirements, index: number): string {
  const dueAt = task.dueAt ? `，截止：${task.dueAt}` : "";
  const requirements =
    task.requirements.length > 0
      ? `\n   要求：${task.requirements.map((item, requirementIndex) => `${requirementIndex + 1}) ${item.content}`).join("；")}`
      : "";
  const detail = task.detail ? `\n   内容：${task.detail}` : "";

  return `${index}. ${task.title}（${toTaskStatusLabel(task.status)}，${formatPriority(task.priority)}${dueAt}）${detail}${requirements}`;
}

function formatPriority(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    low: "低",
    medium: "中",
    high: "高"
  };

  return labels[priority];
}

function formatRequirementsForClarification(requirements: TaskRequirement[]): string {
  if (requirements.length === 0) return "暂无要求";
  return requirements.map((requirement, index) => `${index + 1}. ${requirement.content}`).join("；");
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    status: task.status,
    statusLabel: toTaskStatusLabel(task.status),
    priority: task.priority,
    priorityLabel: formatPriority(task.priority),
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function serializeTaskWithRequirements(task: TaskWithRequirements) {
  return {
    ...serializeTask(task),
    requirements: task.requirements.map(serializeRequirement)
  };
}

function serializeRequirement(requirement: TaskRequirement) {
  return {
    id: requirement.id,
    content: requirement.content,
    createdAt: requirement.createdAt,
    updatedAt: requirement.updatedAt
  };
}

function extractTaskTitles(content: string): string[] {
  return content
    .split(/\n|；|;/u)
    .map((line) => line.replace(/^[-*•\d.、\s]+/u, "").trim())
    .filter((line) => line.length >= 2)
    .slice(0, 20);
}

function isMeaningfulTitle(title: string): boolean {
  const cleaned = title.trim();
  return cleaned.length > 0 && cleaned !== "未命名任务";
}

function getEntityString(entities: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function getEntityNumber(entities: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string") {
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric > 0) return numeric;
    }
  }

  return undefined;
}

function getEntityPriority(entities: Record<string, unknown>): TaskPriority | undefined {
  const value = getEntityString(entities, ["priority", "newPriority"]);
  if (!value) return undefined;
  if (/high|高|紧急|重要/iu.test(value)) return "high";
  if (/low|低|不急/iu.test(value)) return "low";
  if (/medium|中|普通/iu.test(value)) return "medium";
  return undefined;
}

function getEntityStatus(entities: Record<string, unknown>): TaskStatus | undefined {
  const value = getEntityString(entities, ["status", "newStatus"]);
  if (!value) return undefined;
  if (/done|完成|已完成/iu.test(value)) return "done";
  if (/in_progress|进行中|处理中/iu.test(value)) return "in_progress";
  if (/cancelled|canceled|取消|已取消/iu.test(value)) return "cancelled";
  if (/open|未开始|打开/iu.test(value)) return "open";
  return undefined;
}
