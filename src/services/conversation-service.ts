import { ConversationRepository } from "../repositories/conversation-repository";
import type { Conversation, ConversationMessage } from "../types/domain";

export class ConversationService {
  private readonly conversationRepository: ConversationRepository;

  constructor(db: D1Database) {
    this.conversationRepository = new ConversationRepository(db);
  }

  async resolveConversation(input: {
    conversationId?: string;
    userId: string;
    firstMessage: string;
  }): Promise<Conversation> {
    return this.conversationRepository.ensureConversation({
      id: input.conversationId,
      userId: input.userId,
      firstMessage: input.firstMessage
    });
  }

  async saveUserMessage(input: {
    conversationId: string;
    content: string;
    intent?: string | null;
  }): Promise<ConversationMessage> {
    return this.conversationRepository.saveMessage({
      conversationId: input.conversationId,
      role: "user",
      content: input.content,
      intent: input.intent
    });
  }

  async saveAssistantMessage(input: {
    conversationId: string;
    content: string;
    intent?: string | null;
  }): Promise<ConversationMessage> {
    return this.conversationRepository.saveMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.content,
      intent: input.intent
    });
  }

  async getRecentMessages(conversationId: string, limit = 10): Promise<ConversationMessage[]> {
    return this.conversationRepository.listRecentMessages(conversationId, limit);
  }
}
