import type { TaskPriority, TaskStatus } from "../types/domain";

export type TaskCommand =
  | { type: "create"; title: string; detail: string; dueAt: string | null; priority: TaskPriority }
  | { type: "list" }
  | { type: "detail"; target: string; targetIndex?: number }
  | { type: "update"; target: string; title?: string; dueAt?: string | null; priority?: TaskPriority; status?: TaskStatus }
  | { type: "complete"; target: string }
  | { type: "delete"; target: string }
  | { type: "add_requirement"; target: string; content: string }
  | { type: "update_requirement"; target: string; requirementIndex?: number; requirementTarget?: string; content: string }
  | { type: "delete_requirement"; target: string; requirementIndex?: number; requirementTarget?: string }
  | { type: "extract_from_text"; content: string }
  | { type: "unknown" };

const createKeywords = [
  "创建任务",
  "创建一个任务",
  "新增任务",
  "新增一个任务",
  "添加任务",
  "添加一个任务",
  "加一个任务",
  "加入任务",
  "提醒我",
  "帮我记",
  "todo"
];
const listKeywords = ["查看任务", "列出任务", "任务列表", "有哪些任务", "我的任务", "待办"];
const detailKeywords = ["任务详情", "任务具体内容", "具体内容", "详情", "要求是什么", "内容是什么"];
const updateKeywords = ["更新任务", "修改任务", "编辑任务", "调整任务", "改成", "改为", "优先级改", "截止时间改"];
const completeKeywords = ["完成任务", "标记完成", "设为完成", "做完了", "已完成"];
const deleteKeywords = ["删除任务", "移除任务", "取消任务"];
const requirementKeywords = ["加一条要求", "添加要求", "新增要求", "补充要求", "加一个需求", "添加需求"];
const updateRequirementKeywords = ["修改要求", "更新要求", "编辑要求", "修改需求", "更新需求", "编辑需求"];
const deleteRequirementKeywords = ["删除要求", "移除要求", "删除需求", "移除需求"];
const extractKeywords = ["提取任务", "拆解任务", "生成任务列表", "整理成任务"];

export function parseTaskCommand(message: string): TaskCommand {
  const normalized = message.trim();

  const requirement = parseAddRequirement(normalized);
  if (requirement) return requirement;

  const updateRequirement = parseUpdateRequirement(normalized);
  if (updateRequirement) return updateRequirement;

  const deleteRequirement = parseDeleteRequirement(normalized);
  if (deleteRequirement) return deleteRequirement;

  if (containsAny(normalized, listKeywords)) {
    return { type: "list" };
  }

  const detail = parseDetail(normalized);
  if (detail) return detail;

  const update = parseUpdate(normalized);
  if (update) return update;

  if (containsAny(normalized, createKeywords)) {
    return {
      type: "create",
      title: extractTaskTitle(normalized),
      detail: extractTaskDetail(normalized),
      dueAt: extractDueAt(normalized),
      priority: extractPriority(normalized)
    };
  }

  const complete = parseTargetCommand(normalized, completeKeywords, "complete");
  if (complete) return complete;

  const deletion = parseTargetCommand(normalized, deleteKeywords, "delete");
  if (deletion) return deletion;

  if (containsAny(normalized, extractKeywords)) {
    return {
      type: "extract_from_text",
      content: cleanup(normalized.replace(/^.*?(?:提取任务|拆解任务|生成任务列表|整理成任务)[:：]?/u, ""))
    };
  }

  return { type: "unknown" };
}

export function toTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    open: "未开始",
    in_progress: "进行中",
    done: "已完成",
    cancelled: "已取消"
  };

  return labels[status];
}

function parseAddRequirement(message: string): TaskCommand | null {
  if (!containsAny(message, requirementKeywords)) return null;

  const targetMatch = message.match(/(?:给|为|到)\s*(.+?)\s*(?:这个任务|任务)?(?:加一条要求|添加要求|新增要求|补充要求|加一个需求|添加需求)/u);
  const contentMatch = message.match(/(?:要求|需求)[：:]\s*(.+)$/u);

  return {
    type: "add_requirement",
    target: cleanup(targetMatch?.[1] ?? ""),
    content: cleanup(contentMatch?.[1] ?? message.replace(/^.*(?:要求|需求)[：:]/u, ""))
  };
}

function parseUpdateRequirement(message: string): TaskCommand | null {
  if (!containsAny(message, updateRequirementKeywords) && !/(修改|更新|编辑).*(要求|需求)/u.test(message)) return null;

  const targetMatch = message.match(/(?:给|把|将|修改|更新|编辑)?\s*(.+?)\s*(?:这个任务|任务)?(?:的)?(?:第?[一二三四五六七八九十\d]+条)?(?:要求|需求)/u);
  const contentMatch = message.match(/(?:改成|改为|更新为|修改为|变成|内容为)[：:]?\s*(.+)$/u);

  return {
    type: "update_requirement",
    target: cleanup(targetMatch?.[1] ?? ""),
    requirementIndex: extractRequirementIndex(message),
    requirementTarget: cleanup(message.match(/(?:要求|需求)[“"]?([^“”"，,。.!！?？]+)[”"]?/u)?.[1] ?? ""),
    content: cleanup(contentMatch?.[1] ?? "")
  };
}

function parseDeleteRequirement(message: string): TaskCommand | null {
  if (!containsAny(message, deleteRequirementKeywords) && !/(删除|移除).*(要求|需求)/u.test(message)) return null;

  const targetMatch = message.match(/(?:给|把|将|删除|移除)?\s*(.+?)\s*(?:这个任务|任务)?(?:的)?(?:第?[一二三四五六七八九十\d]+条)?(?:要求|需求)/u);

  return {
    type: "delete_requirement",
    target: cleanup(targetMatch?.[1] ?? ""),
    requirementIndex: extractRequirementIndex(message),
    requirementTarget: cleanup(message.match(/(?:要求|需求)[“"]?([^“”"，,。.!！?？]+)[”"]?/u)?.[1] ?? "")
  };
}

function parseDetail(message: string): TaskCommand | null {
  if (!containsAny(message, detailKeywords)) return null;

  const target = cleanup(
    message
      .replace(/(?:任务详情|任务具体内容|具体内容|详情|要求是什么|内容是什么|任务|是什么|请问|帮我|看一下|查看)/gu, "")
      .replace(/^(第?[一二三四五六七八九十\d]+个|第?[一二三四五六七八九十\d]+条)/u, "")
  );

  return {
    type: "detail",
    target,
    targetIndex: extractOrdinal(message)
  };
}

function parseUpdate(message: string): TaskCommand | null {
  if (!containsAny(message, updateKeywords)) return null;
  const dueAt = extractDueAt(message);

  const updates = {
    title: extractUpdatedTitle(message),
    dueAt: hasDueAtClearIntent(message) ? null : dueAt ?? undefined,
    priority: extractPriorityPatch(message),
    status: extractStatusPatch(message)
  };

  if (
    updates.title === undefined &&
    updates.dueAt === undefined &&
    updates.priority === undefined &&
    updates.status === undefined
  ) {
    return null;
  }

  return {
    type: "update",
    target: extractUpdateTarget(message),
    ...updates
  };
}

function parseTargetCommand(
  message: string,
  keywords: string[],
  type: "complete" | "delete"
): TaskCommand | null {
  const actionPattern =
    type === "complete"
      ? /(?:完成|做完|标记完成)\s*(.+?)\s*(?:这个任务|任务)?$/u
      : /(?:删除|移除|取消)\s*(.+?)\s*(?:这个任务|任务)?$/u;

  if (!containsAny(message, keywords)) {
    const match = message.match(actionPattern);
    if (!match) return null;
    return {
      type,
      target: cleanup(match[1] ?? "")
    };
  }

  const keyword = keywords.find((item) => message.includes(item));
  const target = cleanup(keyword ? message.replace(keyword, "") : message);

  return {
    type,
    target
  };
}

function extractTaskTitle(message: string): string {
  const withoutPrefix = message
    .replace(/^(请|帮我|给我|麻烦)?\s*(创建任务|新增任务|添加任务|加一个任务|加入任务|提醒我|帮我记|todo)[:：]?\s*/iu, "")
    .replace(/^(请|帮我|给我|麻烦)?\s*(创建一个任务|新增一个任务|添加一个任务)[:：]?\s*/iu, "")
    .replace(/(明天|今天|后天|下周|上午|下午|晚上|中午|早上|今晚|明早|截止|到期|提醒).*$/u, "")
    .replace(/(高优先级|低优先级|优先级高|优先级低|紧急|重要)/u, "");

  const title = cleanup(withoutPrefix);
  return title || "未命名任务";
}

function extractTaskDetail(message: string): string {
  return cleanup(
    message
      .replace(/^(请|帮我|给我|麻烦)?\s*(创建任务|新增任务|添加任务|加一个任务|加入任务|提醒我|帮我记|todo)[:：]?\s*/iu, "")
      .replace(/^(请|帮我|给我|麻烦)?\s*(创建一个任务|新增一个任务|添加一个任务)[:：]?\s*/iu, "")
      .replace(/(高优先级|低优先级|优先级高|优先级低|紧急|重要)/gu, "")
  );
}

function extractDueAt(message: string): string | null {
  const patterns = [
    /(明天(?:上午|下午|晚上|中午|早上)?\s*\d{1,2}(?:点|:\d{2})?)/u,
    /(后天(?:上午|下午|晚上|中午|早上)?\s*\d{1,2}(?:点|:\d{2})?)/u,
    /(今天(?:上午|下午|晚上|中午|早上)?\s*\d{1,2}(?:点|:\d{2})?)/u,
    /(\d+\s*(?:分钟|小时|天)后)/u,
    /(下周[一二三四五六日天]?(?:上午|下午|晚上|中午|早上)?\s*\d{0,2}(?:点|:\d{2})?)/u,
    /(\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?)/u
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, "");
  }

  return null;
}

function extractPriority(message: string): TaskPriority {
  if (/高优先级|优先级高|紧急|重要/u.test(message)) return "high";
  if (/低优先级|优先级低|不急/u.test(message)) return "low";
  return "medium";
}

function extractPriorityPatch(message: string): TaskPriority | undefined {
  if (/高优先级|优先级高|紧急|重要|改成高|改为高/u.test(message)) return "high";
  if (/低优先级|优先级低|不急|改成低|改为低/u.test(message)) return "low";
  if (/中优先级|优先级中|普通|改成中|改为中/u.test(message)) return "medium";
  return undefined;
}

function extractStatusPatch(message: string): TaskStatus | undefined {
  if (/进行中|开始做|处理中/u.test(message)) return "in_progress";
  if (/完成|已完成|做完/u.test(message)) return "done";
  if (/取消|已取消/u.test(message)) return "cancelled";
  if (/未开始|重新打开|重开/u.test(message)) return "open";
  return undefined;
}

function extractUpdatedTitle(message: string): string | undefined {
  const match =
    message.match(/^(?:把|将)\s*.+?\s*(?:这个任务|任务)?(?:改成|改为|修改为|更新为|变成)[：:]?\s*([^，,。.!！?？]+)/u) ??
    message.match(/(?:标题|名称)(?:改成|改为|修改为|更新为|变成)[：:]?\s*([^，,。.!！?？]+)/u);
  const value = cleanup(match?.[1] ?? "");
  return value || undefined;
}

function extractUpdateTarget(message: string): string {
  const match = message.match(/(?:把|将|更新任务|修改任务|编辑任务|调整任务)\s*(.+?)\s*(?:这个任务|任务)?(?:的)?(?:标题|名称|截止|时间|优先级|状态|改成|改为|修改为|更新为|变成)/u);
  return cleanup(match?.[1] ?? "");
}

function hasDueAtClearIntent(message: string): boolean {
  return /(?:清除|删除|取消|移除).*(?:截止|时间|到期)|(?:截止|时间|到期).*(?:清除|删除|取消|移除)/u.test(message);
}

function extractRequirementIndex(message: string): number | undefined {
  const match = message.match(/第?\s*([一二三四五六七八九十\d]+)\s*条/u);
  if (!match?.[1]) return undefined;
  return parseChineseOrdinal(match[1]);
}

function extractOrdinal(message: string): number | undefined {
  const match = message.match(/第?\s*([一二三四五六七八九十\d]+)\s*(?:个|条|项|号)/u);
  if (!match?.[1]) return undefined;
  return parseChineseOrdinal(match[1]);
}

function parseChineseOrdinal(value: string): number | undefined {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;

  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };

  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }

  return digits[value];
}

function containsAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()));
}

function cleanup(value: string): string {
  return value
    .replace(/^[：:\s，,。.!！?？]+/u, "")
    .replace(/[，。,.!！?？]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}
