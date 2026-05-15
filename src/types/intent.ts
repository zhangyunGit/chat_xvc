import type { ChatMessage } from "./chat";
import type { ConversationMessage } from "./domain";

export type IntentName =
  | "profile.collect_user_info"
  | "profile.update_user_info"
  | "profile.update_ai_nickname"
  | "profile.reset"
  | "profile.query"
  | "task.create"
  | "task.list"
  | "task.detail"
  | "task.update"
  | "task.complete"
  | "task.delete"
  | "task.add_requirement"
  | "task.update_requirement"
  | "task.delete_requirement"
  | "task.extract_from_text"
  | "document.upload_help"
  | "document.list"
  | "document.delete"
  | "document.search"
  | "document.summarize"
  | "document.qa"
  | "document.extract_tasks"
  | "document.compare"
  | "memory.write"
  | "memory.recall"
  | "memory.delete"
  | "memory.list"
  | "research.quick_search"
  | "research.deep_report"
  | "research.compare_options"
  | "research.fact_check"
  | "research.latest_info"
  | "conversation.smalltalk"
  | "conversation.clarify"
  | "conversation.general_qa"
  | "conversation.help"
  | "conversation.capability_intro";

export type PromptTemplateName =
  | "onboarding"
  | "profile"
  | "task_manager"
  | "rag_answer"
  | "deep_research"
  | "general_chat"
  | "clarification";

export type IntentDecision = {
  intent: IntentName;
  confidence: number;
  entities: Record<string, unknown>;
  requiredTools: string[];
  promptTemplate: PromptTemplateName;
  needsClarification: boolean;
  clarificationQuestion?: string;
  needsRag: boolean;
  needsWebSearch: boolean;
  shouldWriteMemory: boolean;
  source: "rule" | "llm" | "fallback";
};

export type IntentRouteInput = {
  message: string;
  recentMessages: RecentIntentMessage[];
  userName: string | null;
  userEmail: string | null;
  aiNickname: string;
  profileChanged: boolean;
  profileReset: boolean;
  missingProfileFields: Array<"name" | "email">;
};

export type RecentIntentMessage = Pick<ConversationMessage, "role" | "content" | "intent" | "createdAt">;

export type IntentRouteResult = {
  decision: IntentDecision;
  llmCall?: {
    promptMessages: ChatMessage[];
    responseText: string;
  };
};

export type IntentRegistryItem = {
  intent: IntentName;
  description: string;
  requiredTools: string[];
  promptTemplate: PromptTemplateName;
  needsRag: boolean;
  needsWebSearch: boolean;
  shouldWriteMemory: boolean;
};
