import type { CreateMemoryInput, MemoryKind, MemoryStatus, UserMemory } from "../types/domain";

type MemoryRow = {
  id: string;
  user_id: string;
  content: string;
  kind: MemoryKind;
  vector_id: string;
  source_message_id: string | null;
  confidence: number;
  status: MemoryStatus;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
};

export class MemoryRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateMemoryInput): Promise<UserMemory> {
    const id = input.id ?? crypto.randomUUID();

    await this.db
      .prepare(
        `INSERT INTO memories (
          id,
          user_id,
          content,
          kind,
          vector_id,
          source_message_id,
          confidence,
          embedding_model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.userId,
        input.content,
        input.kind,
        input.vectorId,
        input.sourceMessageId ?? null,
        input.confidence ?? 1,
        input.embeddingModel ?? ""
      )
      .run();

    const memory = await this.findById(input.userId, id);
    if (!memory) {
      throw new Error("Failed to create memory");
    }

    return memory;
  }

  async findById(userId: string, id: string): Promise<UserMemory | null> {
    const row = await this.db
      .prepare("SELECT * FROM memories WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first<MemoryRow>();

    return row ? toMemory(row) : null;
  }

  async listActiveByUser(userId: string, limit = 50): Promise<UserMemory[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM memories WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC, rowid DESC LIMIT ?"
      )
      .bind(userId, limit)
      .all<MemoryRow>();

    return rows.results.map(toMemory);
  }

  async listByVectorIds(userId: string, vectorIds: string[]): Promise<UserMemory[]> {
    if (vectorIds.length === 0) return [];

    const placeholders = vectorIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT * FROM memories WHERE user_id = ? AND status = 'active' AND vector_id IN (${placeholders})`
      )
      .bind(userId, ...vectorIds)
      .all<MemoryRow>();

    return rows.results.map(toMemory);
  }

  async softDelete(userId: string, ids: string[]): Promise<UserMemory[]> {
    if (ids.length === 0) return [];

    const memories = await this.listByIds(userId, ids);
    const placeholders = ids.map(() => "?").join(", ");
    await this.db
      .prepare(
        `UPDATE memories SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(userId, ...ids)
      .run();

    return memories;
  }

  private async listByIds(userId: string, ids: string[]): Promise<UserMemory[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(`SELECT * FROM memories WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(userId, ...ids)
      .all<MemoryRow>();

    return rows.results.map(toMemory);
  }
}

function toMemory(row: MemoryRow): UserMemory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    kind: row.kind,
    vectorId: row.vector_id,
    sourceMessageId: row.source_message_id,
    confidence: row.confidence,
    status: row.status,
    embeddingModel: row.embedding_model ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
