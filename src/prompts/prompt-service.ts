import { createGeneralChatPrompt, createClarificationPrompt } from "./general-prompts";
import { createOnboardingPrompt, createProfilePrompt } from "./profile-prompts";
import { createRagAnswerPrompt } from "./rag-prompts";
import { createDeepResearchPrompt } from "./research-prompts";
import { createTaskManagerPrompt } from "./task-prompts";
import type { ChatMessage } from "../types/chat";
import type { ConversationMessage, UserProfile } from "../types/domain";
import type { IntentDecision, PromptTemplateName } from "../types/intent";
import type { SearchResult } from "../types/search";
import type { RecalledMemory } from "../services/memory-service";

export type PromptContext = {
  user: UserProfile;
  decision: IntentDecision;
  userMessage: string;
  searchResults?: SearchResult[];
  toolResultText?: string;
  memories?: RecalledMemory[];
  recentMessages?: ConversationMessage[];
};

export function createPromptMessages(context: PromptContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: createSystemPrompt(context)
    },
    ...createRecentChatMessages(context.recentMessages ?? []),
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
    createMemoryBlock(context.memories ?? []),
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

function createRecentChatMessages(messages: ConversationMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function createMemoryBlock(memories: RecalledMemory[]): string {
  if (memories.length === 0) return "";

  return [
    "长期记忆、相关对话片段与阶段摘要（仅在相关时使用，不要主动暴露内部分数）：",
    ...memories.map((memory, index) =>
      `${index + 1}. [${memory.kind}] ${memory.content}`
    )
  ].join("\n");
}

function createUserMessage(context: PromptContext): string {
  if (context.toolResultText) {
    return [
      "用户最近输入：",
      context.userMessage,
      "",
      "工具执行/检索结果：",
      context.toolResultText,
      "",
      "请严格基于工具结果回复：如果工具已成功执行，说明结果；如果工具未执行且缺少参数，向用户追问缺失参数。不要编造工具结果中不存在的信息。"
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
