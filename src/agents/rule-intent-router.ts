import { parseTaskCommand } from "../tools/task-command-parser";
import { isProfileResetIntent } from "../tools/profile-tools";
import type { IntentDecision, IntentRouteInput } from "../types/intent";
import { createIntentDecision } from "./intent-utils";

export class RuleIntentRouter {
  route(input: IntentRouteInput): IntentDecision | null {
    const message = input.message.trim();
    const pendingIntent = getPendingConfirmationIntent(input);

    if (pendingIntent && isAffirmative(message)) {
      return createIntentDecision({
        intent: pendingIntent,
        confidence: 0.99,
        entities: { confirmed: true },
        source: "rule"
      });
    }

    if (pendingIntent && isNegative(message)) {
      return createIntentDecision({
        intent: "conversation.clarify",
        confidence: 0.99,
        needsClarification: true,
        clarificationQuestion: "好的，已取消这次操作。你还需要我做什么？",
        entities: { cancelledIntent: pendingIntent },
        source: "rule"
      });
    }

    if (input.profileReset || isProfileResetIntent(message)) {
      return createIntentDecision({
        intent: "profile.reset",
        confidence: 1,
        needsClarification: true,
        clarificationQuestion:
          "你确定要重置用户资料吗？这会开启新的用户资料，并让当前浏览器切换到新的用户身份。请回复“确定”或“取消”。",
        entities: { requiresConfirmation: true },
        source: "rule"
      });
    }

    if (isProfileQuery(message)) {
      return createIntentDecision({
        intent: "profile.query",
        confidence: 0.92,
        entities: { field: detectProfileQueryField(message) },
        source: "rule"
      });
    }

    const taskCommand = parseTaskCommand(message);
    if (taskCommand.type !== "unknown") {
      return createIntentDecision({
        intent: toTaskIntent(taskCommand.type),
        confidence: taskCommand.type === "create" ? 0.84 : 0.93,
        entities: taskCommand,
        source: "rule"
      });
    }

    if (/^(你好|您好|hi|hello|hey)$/iu.test(message)) {
      return createIntentDecision({
        intent: "conversation.smalltalk",
        confidence: 0.9,
        source: "rule"
      });
    }

    if (/你能做什么|有什么功能|怎么用|帮助|help/i.test(message)) {
      return createIntentDecision({
        intent: "conversation.capability_intro",
        confidence: 0.9,
        source: "rule"
      });
    }

    if (/最新|最近|实时|搜索|查一下|查找|调研|研究|对比|比较|核实|fact.?check/i.test(message)) {
      return createIntentDecision({
        intent: detectResearchIntent(message),
        confidence: 0.88,
        entities: { query: message },
        source: "rule"
      });
    }

    return null;
  }
}

function isProfileQuery(message: string): boolean {
  return /我的(姓名|名字|邮箱|邮件|email|昵称)|我叫什么|你叫什/u.test(message);
}

function detectProfileQueryField(message: string): "name" | "email" | "aiNickname" | "unknown" {
  if (/邮箱|邮件|email/i.test(message)) return "email";
  if (/姓名|名字|我叫什么/u.test(message)) return "name";
  if (/你叫|昵称/u.test(message)) return "aiNickname";
  return "unknown";
}

function toTaskIntent(type: ReturnType<typeof parseTaskCommand>["type"]) {
  const mapping = {
    create: "task.create",
    list: "task.list",
    detail: "task.detail",
    update: "task.update",
    complete: "task.complete",
    delete: "task.delete",
    add_requirement: "task.add_requirement",
    update_requirement: "task.update_requirement",
    delete_requirement: "task.delete_requirement",
    extract_from_text: "task.extract_from_text"
  } as const;

  return mapping[type as keyof typeof mapping] ?? "conversation.clarify";
}

function detectResearchIntent(message: string) {
  if (/调研|研究|报告|深度/u.test(message)) return "research.deep_report";
  if (/对比|比较/u.test(message)) return "research.compare_options";
  if (/核实|是否属实|真假|fact.?check/i.test(message)) return "research.fact_check";
  if (/最新|最近|实时/u.test(message)) return "research.latest_info";
  return "research.quick_search";
}

function getPendingConfirmationIntent(input: IntentRouteInput) {
  const lastAssistantMessage = [...input.recentMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.intent);

  if (
    lastAssistantMessage?.intent === "profile.reset" &&
    /确定|确认|取消|重置|用户资料|新的用户身份/u.test(lastAssistantMessage.content)
  ) {
    return "profile.reset";
  }

  return null;
}

function isAffirmative(message: string): boolean {
  return /^(确定|确认|是的|是|对|对的|可以|继续|没错|好|好的|yes|y|ok|okay)$/iu.test(message);
}

function isNegative(message: string): boolean {
  return /^(取消|不用|不用了|不要|否|不是|算了|no|n)$/iu.test(message);
}
