import { MemoryRepository } from "../repositories/memory-repository";
import { VectorRepository } from "../repositories/vector-repository";
import { WorkersAiProvider } from "../providers/workers-ai-provider";
import type { MemoryKind, UserMemory } from "../types/domain";

export type RecalledMemory = UserMemory & {
  score: number;
};

export type MemoryVectorType = "memory" | "conversation_memory" | "conversation_summary";

const recallTopK = 8;
const memoryListLimit = 50;
const semanticDeleteThreshold = 0.62;
const maxConversationMemoryLength = 1200;
const maxConversationSummaryLength = 1600;

export class MemoryService {
  private readonly embeddingProvider: WorkersAiProvider;
  private readonly memoryRepository: MemoryRepository;
  private readonly vectorRepository: VectorRepository;

  constructor(private readonly env: Env) {
    this.embeddingProvider = new WorkersAiProvider(env);
    this.memoryRepository = new MemoryRepository(env.DB);
    this.vectorRepository = new VectorRepository(env.VECTORIZE);
  }

  async writeMemory(input: {
    userId: string;
    message: string;
    sourceMessageId?: string | null;
  }): Promise<UserMemory> {
    const content = extractMemoryContent(input.message);
    if (!content) {
      throw new Error("Memory content is empty");
    }

    const id = crypto.randomUUID();
    const vectorId = `memory:${id}`;
    const embeddingModel = this.env.DEFAULT_EMBEDDING_MODEL;
    const values = await this.embedOne(content);
    const kind = classifyMemoryKind(content);

    const memory = await this.memoryRepository.create({
      id,
      userId: input.userId,
      content,
      kind,
      vectorId,
      sourceMessageId: input.sourceMessageId ?? null,
      confidence: 1,
      embeddingModel
    });

    try {
      await this.vectorRepository.upsert([
        {
          id: vectorId,
          values,
          metadata: {
            type: "memory",
            userId: input.userId,
            memoryId: id,
            kind,
            status: "active",
            embeddingModel
          }
        }
      ]);
    } catch (error) {
      await this.memoryRepository.softDelete(input.userId, [id]);
      throw error;
    }

    return memory;
  }

  async recall(input: {
    userId: string;
    query: string;
    topK?: number;
    types?: MemoryVectorType[];
  }): Promise<RecalledMemory[]> {
    const query = input.query.trim();
    if (!query) return [];

    const values = await this.embedOne(query);
    const types = input.types ?? ["memory"];
    const matches = dedupeMatchesById(
      await Promise.all(
        types.map((type) =>
          this.vectorRepository.query({
            values,
            userId: input.userId,
            topK: input.topK ?? recallTopK,
            filter: {
              type,
              status: "active"
            }
          })
        )
      )
    ).slice(0, input.topK ?? recallTopK);

    const memories = await this.memoryRepository.listByVectorIds(
      input.userId,
      matches.map((match) => match.id)
    );
    const memoryByVectorId = new Map(memories.map((memory) => [memory.vectorId, memory]));

    return matches
      .map((match): RecalledMemory | null => {
        const memory = memoryByVectorId.get(match.id);
        return memory ? { ...memory, score: match.score } : null;
      })
      .filter((memory): memory is RecalledMemory => Boolean(memory));
  }

  async writeConversationMemory(input: {
    userId: string;
    userMessage: string;
    assistantReply: string;
    sourceMessageId?: string | null;
  }): Promise<UserMemory | null> {
    if (!shouldStoreConversationMemory(input.userMessage, input.assistantReply)) {
      return null;
    }

    const content = createConversationMemoryContent(input.userMessage, input.assistantReply);
    const id = crypto.randomUUID();
    const vectorId = `cmem:${id}`;
    const embeddingModel = this.env.DEFAULT_EMBEDDING_MODEL;
    const values = await this.embedOne(content);

    const memory = await this.memoryRepository.create({
      id,
      userId: input.userId,
      content,
      kind: "conversation",
      vectorId,
      sourceMessageId: input.sourceMessageId ?? null,
      confidence: 0.72,
      embeddingModel
    });

    try {
      await this.vectorRepository.upsert([
        {
          id: vectorId,
          values,
          metadata: {
            type: "conversation_memory",
            userId: input.userId,
            memoryId: id,
            kind: "conversation",
            status: "active",
            embeddingModel
          }
        }
      ]);
    } catch (error) {
      await this.memoryRepository.softDelete(input.userId, [id]);
      throw error;
    }

    return memory;
  }

  async writeConversationSummaryMemory(input: {
    userId: string;
    summary: string;
    sourceMessageId?: string | null;
  }): Promise<UserMemory | null> {
    const content = compactText(input.summary, maxConversationSummaryLength);
    if (content.length < 80) {
      return null;
    }

    const id = crypto.randomUUID();
    const vectorId = `csum:${id}`;
    const embeddingModel = this.env.DEFAULT_EMBEDDING_MODEL;
    const values = await this.embedOne(content);

    const memory = await this.memoryRepository.create({
      id,
      userId: input.userId,
      content,
      kind: "conversation_summary",
      vectorId,
      sourceMessageId: input.sourceMessageId ?? null,
      confidence: 0.82,
      embeddingModel
    });

    try {
      await this.vectorRepository.upsert([
        {
          id: vectorId,
          values,
          metadata: {
            type: "conversation_summary",
            userId: input.userId,
            memoryId: id,
            kind: "conversation_summary",
            status: "active",
            embeddingModel
          }
        }
      ]);
    } catch (error) {
      await this.memoryRepository.softDelete(input.userId, [id]);
      throw error;
    }

    return memory;
  }

  async listMemories(userId: string): Promise<UserMemory[]> {
    return this.memoryRepository.listActiveByUser(userId, memoryListLimit);
  }

  async deleteMemories(input: {
    userId: string;
    query: string;
  }): Promise<UserMemory[]> {
    const target = extractDeleteTarget(input.query);
    if (!target) return [];

    const activeMemories = await this.memoryRepository.listActiveByUser(input.userId, memoryListLimit);
    const normalizedTarget = normalizeForMatch(target);
    const normalizedTargetCore = normalizeMemoryDeleteTarget(target);
    const exactMatches = activeMemories.filter((memory) =>
      normalizeForMatch(memory.content).includes(normalizedTarget) ||
      (normalizedTargetCore.length >= 2 && normalizeForMatch(memory.content).includes(normalizedTargetCore))
    );

    const memoriesToDelete = exactMatches.length > 0
      ? exactMatches
      : (await this.recall({ userId: input.userId, query: target, topK: 3 }))
          .filter((memory) => memory.score >= semanticDeleteThreshold)
          .slice(0, 1);

    if (memoriesToDelete.length === 0) return [];

    const deleted = await this.memoryRepository.softDelete(
      input.userId,
      memoriesToDelete.map((memory) => memory.id)
    );
    await this.vectorRepository.deleteByIds(deleted.map((memory) => memory.vectorId));

    return deleted;
  }

  async deleteMemoryById(input: {
    userId: string;
    memoryId: string;
  }): Promise<UserMemory | null> {
    const memory = await this.memoryRepository.findById(input.userId, input.memoryId);
    if (!memory || memory.status !== "active") return null;

    const deleted = await this.memoryRepository.softDelete(input.userId, [memory.id]);
    await this.vectorRepository.deleteByIds(deleted.map((item) => item.vectorId));

    return deleted[0] ?? null;
  }

  private async embedOne(text: string): Promise<number[]> {
    const vectors = await this.embeddingProvider.embed([text]);
    const vector = vectors[0];
    const expectedDimensions = Number(this.env.VECTOR_DIMENSIONS);

    if (!vector) {
      throw new Error("Failed to generate memory embedding");
    }

    if (expectedDimensions && vector.length !== expectedDimensions) {
      throw new Error(
        `Memory embedding dimension mismatch for ${this.env.DEFAULT_EMBEDDING_MODEL}: expected ${expectedDimensions}, got ${vector.length}`
      );
    }

    return vector;
  }
}

export function extractMemoryContent(message: string): string {
  const trimmed = message.trim();
  const patterns = [
    /^(请)?(帮我)?记住[:：]?\s*(.+)$/u,
    /^(请)?(帮我)?记一下[:：]?\s*(.+)$/u,
    /^以后(你)?(要)?记得[:：]?\s*(.+)$/u,
    /^我的偏好是[:：]?\s*(.+)$/u
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const content = match?.[match.length - 1]?.trim();
    if (content) return content;
  }

  return trimmed;
}

export function extractDeleteTarget(message: string): string {
  const trimmed = message.trim();
  const patterns = [
    /^(请)?(删除|移除|忘记)(一下)?(关于)?[:：]?\s*(.+)$/u,
    /^不要再记得[:：]?\s*(.+)$/u,
    /^忘掉[:：]?\s*(.+)$/u
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const content = match?.[match.length - 1]?.trim();
    if (content) return content;
  }

  return trimmed;
}

function classifyMemoryKind(content: string): MemoryKind {
  if (/喜欢|不喜欢|偏好|习惯|倾向|希望|更愿意|prefer/i.test(content)) return "preference";
  if (/以后|回复|回答|称呼|语气|格式|不要|必须|请用/u.test(content)) return "instruction";
  if (/项目|产品|公司|团队|仓库|系统|业务|客户/u.test(content)) return "project_context";
  if (/我是|我的|生日|地址|城市|学校|职业|身份/u.test(content)) return "fact";
  return "other";
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function normalizeMemoryDeleteTarget(value: string): string {
  return normalizeForMatch(value)
    .replace(/关于/g, "")
    .replace(/记忆/g, "")
    .replace(/内容/g, "")
    .replace(/偏好/g, "")
    .replace(/习惯/g, "")
    .replace(/风格/g, "")
    .replace(/的/g, "");
}

function shouldStoreConversationMemory(userMessage: string, assistantReply: string): boolean {
  const message = userMessage.trim();
  if (message.length < 12 || assistantReply.trim().length < 20) return false;
  if (/^(你好|您好|hi|hello|hey)$/iu.test(message)) return false;
  if (/请记住|记一下|我的偏好是|忘记|删除.*记忆|你现在都记住了什么/u.test(message)) return false;

  return true;
}

function dedupeMatchesById<T extends { id: string; score: number }>(matchesByType: T[][]): T[] {
  const seen = new Set<string>();

  return matchesByType
    .flat()
    .sort((a, b) => b.score - a.score)
    .filter((match) => {
      if (seen.has(match.id)) return false;
      seen.add(match.id);
      return true;
    });
}

function createConversationMemoryContent(userMessage: string, assistantReply: string): string {
  const content = [
    "对话片段：",
    `用户：${compactText(userMessage, 520)}`,
    `助手：${compactText(assistantReply, 620)}`
  ].join("\n");

  return compactText(content, maxConversationMemoryLength);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
