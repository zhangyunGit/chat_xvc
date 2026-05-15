import { createGeneralChatPrompt, createClarificationPrompt } from "./general-prompts";
import { createOnboardingPrompt, createProfilePrompt } from "./profile-prompts";
import { createRagAnswerPrompt } from "./rag-prompts";
import { createDeepResearchPrompt } from "./research-prompts";
import { createTaskManagerPrompt } from "./task-prompts";
import type { ChatMessage } from "../types/chat";
import type { UserProfile } from "../types/domain";
import type { IntentDecision, PromptTemplateName } from "../types/intent";
import type { SearchResult } from "../types/search";

export type PromptContext = {
  user: UserProfile;
  decision: IntentDecision;
  userMessage: string;
  searchResults?: SearchResult[];
  toolResultText?: string;
};

export function createPromptMessages(context: PromptContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: createSystemPrompt(context)
    },
    {
      role: "user",
      content: createUserMessage(context)
    }
  ];
}

function createSystemPrompt(context: PromptContext): string {
  const template = context.decision.promptTemplate;
  const promptByTemplate: Record<PromptTemplateName, string> = {
    onboarding: createOnboardingPrompt(context.user),
    profile: createProfilePrompt(context.user),
    task_manager: createTaskManagerPrompt(context.user),
    rag_answer: createRagAnswerPrompt(context.user),
    deep_research: createDeepResearchPrompt(context.user, context.searchResults ?? []),
    general_chat: createGeneralChatPrompt(context.user),
    clarification: createClarificationPrompt(context.user)
  };

  return [
    promptByTemplate[template],
    "",
    "当前路由决策：",
    JSON.stringify(
      {
        intent: context.decision.intent,
        confidence: context.decision.confidence,
        entities: context.decision.entities,
        requiredTools: context.decision.requiredTools,
        needsRag: context.decision.needsRag,
        needsWebSearch: context.decision.needsWebSearch
      },
      null,
      2
    )
  ].join("\n");
}

function createUserMessage(context: PromptContext): string {
  if (context.toolResultText) {
    return [
      "用户最近输入：",
      context.userMessage,
      "",
      "任务工具执行/参数检查结果：",
      context.toolResultText,
      "",
      "请严格基于工具结果回复：如果工具已成功执行，说明结果；如果工具未执行且缺少参数，向用户追问缺失参数。不要编造数据库中不存在的任务。"
    ].join("\n");
  }

  if (!context.searchResults || context.searchResults.length === 0) {
    return context.userMessage;
  }

  return [
    "用户问题：",
    context.userMessage,
    "",
    "请结合 system prompt 中的搜索结果回答。"
  ].join("\n");
}
