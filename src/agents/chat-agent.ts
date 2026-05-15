import { createPromptMessages } from "../prompts/prompt-service";
import type { LLMProvider } from "../providers/llm-provider";
import type { ChatMessage } from "../types/chat";
import type { UserProfile } from "../types/domain";
import type { IntentDecision } from "../types/intent";
import type { SearchResult } from "../types/search";

export class ChatAgent {
  constructor(private readonly llmProvider: LLMProvider) {}

  async respond(input: {
    userMessage: string;
    user: UserProfile;
    decision: IntentDecision;
    searchResults?: SearchResult[];
    toolResultText?: string;
  }): Promise<{
    reply: string;
    promptMessages: ChatMessage[];
  }> {
    const messages = createPromptMessages(input);
    const reply = await this.llmProvider.chat(messages);

    return {
      reply,
      promptMessages: messages
    };
  }
}
