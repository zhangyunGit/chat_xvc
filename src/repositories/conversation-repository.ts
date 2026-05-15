import type { Conversation, ConversationMessage, MessageRole } from "../types/domain";

type ConversationRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  intent: string | null;
  created_at: string;
};

export class ConversationRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<Conversation | null> {
    const row = await this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .bind(id)
      .first<ConversationRow>();

    return row ? toConversation(row) : null;
  }

  async create(input: { id: string; userId: string; title?: string | null }): Promise<Conversation> {
    await this.db
      .prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)")
      .bind(input.id, input.userId, input.title ?? null)
      .run();

    const conversation = await this.findById(input.id);

    if (!conversation) {
      throw new Error("Failed to create conversation");
    }

    return conversation;
  }

  async ensureConversation(input: {
    id?: string;
    userId: string;
    firstMessage?: string;
  }): Promise<Conversation> {
    if (input.id) {
      const existing = await this.findById(input.id);
      if (existing) return existing;
    }

    return this.create({
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      title: createConversationTitle(input.firstMessage)
    });
  }

  async saveMessage(input: {
    id?: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    intent?: string | null;
  }): Promise<ConversationMessage> {
    const id = input.id ?? crypto.randomUUID();

    await this.db
      .prepare("INSERT INTO messages (id, conversation_id, role, content, intent) VALUES (?, ?, ?, ?, ?)")
      .bind(id, input.conversationId, input.role, input.content, input.intent ?? null)
      .run();

    await this.db
      .prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(input.conversationId)
      .run();

    const row = await this.db.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<MessageRow>();

    if (!row) {
      throw new Error("Failed to save message");
    }

    return toMessage(row);
  }

  async listRecentMessages(conversationId: string, limit = 10): Promise<ConversationMessage[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
      )
      .bind(conversationId, limit)
      .all<MessageRow>();

    return rows.results.map(toMessage).reverse();
  }
}

function createConversationTitle(message?: string): string | null {
  if (!message) return null;
  return message.length > 32 ? `${message.slice(0, 32)}…` : message;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    intent: row.intent,
    createdAt: row.created_at
  };
}
