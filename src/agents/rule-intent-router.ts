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

    if (isDocumentUploadHelpIntent(message)) {
      return createIntentDecision({
        intent: "document.upload_help",
        confidence: 0.91,
        source: "rule"
      });
    }

    if (isDocumentListIntent(message)) {
      return createIntentDecision({
        intent: "document.list",
        confidence: 0.93,
        source: "rule"
      });
    }

    if (isDocumentSummarizeIntent(message)) {
      return createIntentDecision({
        intent: "document.summarize",
        confidence: 0.86,
        entities: { query: message },
        source: "rule"
      });
    }

    if (isDocumentSearchIntent(message)) {
      return createIntentDecision({
        intent: "document.search",
        confidence: 0.88,
        entities: { query: message },
        source: "rule"
      });
    }

    if (isDocumentQaIntent(message)) {
      return createIntentDecision({
        intent: "document.qa",
        confidence: 0.84,
        entities: { query: message },
        source: "rule"
      });
    }

    if (isMemoryListIntent(message)) {
      return createIntentDecision({
        intent: "memory.list",
        confidence: 0.94,
        source: "rule"
      });
    }

    if (isMemoryDeleteIntent(message)) {
      return createIntentDecision({
        intent: "memory.delete",
        confidence: 0.92,
        entities: { target: message },
        source: "rule"
      });
    }

    if (isMemoryRecallIntent(message)) {
      return createIntentDecision({
        intent: "memory.recall",
        confidence: 0.9,
        entities: { query: message },
        source: "rule"
      });
    }

    if (isMemoryWriteIntent(message)) {
      return createIntentDecision({
        intent: "memory.write",
        confidence: 0.92,
        entities: { content: message },
        source: "rule"
      });
    }

    const taskCommand = parseTaskCommand(message);
    if (shouldUseRuleTaskCommand(taskCommand.type)) {
      return createIntentDecision({
        intent: toTaskIntent(taskCommand.type),
        confidence: taskCommand.type === "create" ? 0.84 : 0.93,
        entities: taskCommand,
        source: "rule"
      });
    }

    if (/^(你好|您好|hi|hello|hey)$/iu.test(message)) {
      return createIntentDecision({
        intent: "conversation.chitchat",
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

function isDocumentListIntent(message: string): boolean {
  if (/\[fileId:[^\]\s]+\]/u.test(message)) return false;
  if (/(总结|摘要|概括|归纳)/u.test(message)) return false;

  return /(我|当前|已经)?(上传|添加|保存).*(文件|文档|资料)|文件列表|文档列表|资料列表|我有哪些(文件|文档|资料)/u.test(message);
}

function isDocumentUploadHelpIntent(message: string): boolean {
  return /怎么上传(文件|文档|资料)|如何上传(文件|文档|资料)|上传(文件|文档|资料).*(怎么|如何)/u.test(message);
}

function isDocumentSearchIntent(message: string): boolean {
  return /(搜索|查找|检索|找一下).*(文件|文档|资料)|从(文件|文档|资料).*(搜索|查找|检索)|在(文件|文档|资料)(里|中).*(搜索|查找|检索)/u.test(message);
}

function isDocumentSummarizeIntent(message: string): boolean {
  if (/\[fileId:[^\]\s]+\]/u.test(message) && /(讲了什么|说了什么|主要内容|内容是什么|什么内容|大意|概述|总结|摘要|概括|归纳)/u.test(message)) {
    return true;
  }

  return /(总结|摘要|概括|归纳).*(文件|文档|资料|材料|附件|PDF|pdf|该文档|这个文档|这份文档|这篇)|把.*(文件|文档|资料|材料|附件|PDF|pdf|该文档|这个文档|这份文档|这篇).*(总结|摘要|概括|归纳)|请(总结|摘要|概括|归纳)/u.test(message);
}

function isDocumentQaIntent(message: string): boolean {
  if (/\[fileId:[^\]\s]+\]/u.test(message) && /(回答|说明|解释|是什么|有哪些|多少|怎么|如何|提到|说了|内容|观点|结论|原因|建议)/u.test(message)) {
    return true;
  }

  return /(根据|基于|结合).*(文件|文档|资料|材料|附件|PDF|pdf|这篇|该文档|这个文档).*(回答|说明|解释|是什么|有哪些|多少|怎么|如何)|((文件|文档|资料|材料|附件|PDF|pdf|这篇|该文档|这个文档)(里|中)?.*(是什么|有哪些|多少|怎么|如何|提到|说了|内容))/u.test(message);
}

function isMemoryWriteIntent(message: string): boolean {
  return /^(请)?(帮我)?(记住|记一下)|^以后(你)?(要)?记得|我的偏好是/u.test(message);
}

function isMemoryListIntent(message: string): boolean {
  return /你(现在)?(都)?记住了什么|你(有)?哪些记忆|列出(我的)?记忆|长期记忆列表|记忆列表/u.test(message);
}

function isMemoryRecallIntent(message: string): boolean {
  return /你还记得.*吗|你记得.*吗|回忆一下|查询.*记忆|关于.*你记得什么|(?:刚才|之前|上次|前面).*(提到|说|讨论|聊|项目|目标|内容)/u.test(message);
}

function isMemoryDeleteIntent(message: string): boolean {
  return /^(请)?(删除|移除|忘记|忘掉)|不要再记得/u.test(message) && /记忆|记住|关于|偏好|喜欢|项目|我/u.test(message);
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

function shouldUseRuleTaskCommand(type: ReturnType<typeof parseTaskCommand>["type"]): boolean {
  return type === "create" ||
    type === "list" ||
    type === "detail" ||
    type === "add_requirement" ||
    type === "extract_from_text";
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
