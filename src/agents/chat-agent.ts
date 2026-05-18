import { createPromptMessages } from "../prompts/prompt-service";
import type { LLMProvider } from "../providers/llm-provider";
import type { ChatMessage } from "../types/chat";
import type { ConversationMessage, UserProfile } from "../types/domain";
import type { IntentDecision } from "../types/intent";
import type { SearchResult } from "../types/search";
import type { RecalledMemory } from "../services/memory-service";

export class ChatAgent {
  constructor(private readonly llmProvider: LLMProvider) {}

  async respond(input: {
    userMessage: string;
    user: UserProfile;
    decision: IntentDecision;
    searchResults?: SearchResult[];
    toolResultText?: string;
    memories?: RecalledMemory[];
    recentMessages?: ConversationMessage[];
    onDelta?: (delta: string) => void | Promise<void>;
  }): Promise<{
    reply: string;
    promptMessages: ChatMessage[];
    streamed: boolean;
  }> {
    const messages = createPromptMessages(input);
    const shouldStream = Boolean(this.llmProvider.chatStream && input.onDelta);
    const reply = shouldStream && this.llmProvider.chatStream && input.onDelta
      ? await this.llmProvider.chatStream(messages, undefined, input.onDelta)
      : await this.llmProvider.chat(messages);

    return {
      reply,
      promptMessages: messages,
      streamed: shouldStream
    };
  }
}
