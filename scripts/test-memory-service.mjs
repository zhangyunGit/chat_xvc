import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-memory-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/memory-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "memory-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { MemoryService, extractDeleteTarget, extractMemoryContent } from "./memory-service.mjs";

const memories = [];
const vectorState = {
  upserted: [],
  deleted: [],
  matches: []
};

function createDb() {
  return {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          if (sql.includes("INSERT INTO memories")) {
            const [id, userId, content, kind, vectorId, sourceMessageId, confidence, embeddingModel] = this.values;
            memories.push({
              id,
              user_id: userId,
              content,
              kind,
              vector_id: vectorId,
              source_message_id: sourceMessageId,
              confidence,
              status: "active",
              embedding_model: embeddingModel,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z"
            });
            return {};
          }

          if (sql.includes("UPDATE memories SET status = 'deleted'")) {
            const [userId, ...ids] = this.values;
            for (const memory of memories) {
              if (memory.user_id === userId && ids.includes(memory.id)) {
                memory.status = "deleted";
              }
            }
            return {};
          }

          throw new Error("Unexpected run SQL: " + sql);
        },
        async first() {
          if (sql.includes("WHERE user_id = ? AND id = ?")) {
            const [userId, id] = this.values;
            return memories.find((memory) => memory.user_id === userId && memory.id === id) ?? null;
          }
          throw new Error("Unexpected first SQL: " + sql);
        },
        async all() {
          if (sql.includes("status = 'active'") && sql.includes("vector_id IN")) {
            const [userId, ...vectorIds] = this.values;
            return {
              results: memories.filter((memory) =>
                memory.user_id === userId &&
                memory.status === "active" &&
                vectorIds.includes(memory.vector_id)
              )
            };
          }

          if (sql.includes("status = 'active'")) {
            const [userId, limit] = this.values;
            return {
              results: memories
                .filter((memory) => memory.user_id === userId && memory.status === "active")
                .slice(0, limit)
            };
          }

          if (sql.includes("id IN")) {
            const [userId, ...ids] = this.values;
            return {
              results: memories.filter((memory) => memory.user_id === userId && ids.includes(memory.id))
            };
          }

          throw new Error("Unexpected all SQL: " + sql);
        }
      };
    }
  };
}

const env = {
  DB: createDb(),
  DEFAULT_EMBEDDING_MODEL: "@cf/baai/bge-m3",
  VECTOR_DIMENSIONS: "4",
  AI: {
    async run(model, input) {
      return {
        data: input.text.map((text) => {
          const base = text.length / 100;
          return [base, base + 0.1, base + 0.2, base + 0.3];
        })
      };
    }
  },
  VECTORIZE: {
    async upsert(vectors) {
      vectorState.upserted.push(...vectors);
    },
    async deleteByIds(ids) {
      vectorState.deleted.push(...ids);
    },
    async query(values, options) {
      vectorState.lastQuery = { values, options };
      const type = options?.filter?.type;
      return {
        matches: type
          ? vectorState.matches.filter((match) => !match.metadata?.type || match.metadata.type === type)
          : vectorState.matches
      };
    }
  }
};

if (extractMemoryContent("请记住：我喜欢简洁的回答") !== "我喜欢简洁的回答") {
  throw new Error("Expected memory content extraction");
}
if (extractDeleteTarget("忘记关于简洁回答的偏好") !== "简洁回答的偏好") {
  throw new Error("Expected delete target extraction");
}

const service = new MemoryService(env);
const memory = await service.writeMemory({
  userId: "u1",
  message: "请记住：我喜欢简洁的回答",
  sourceMessageId: "m1"
});

if (memory.kind !== "preference") throw new Error("Expected preference memory");
if (vectorState.upserted.length !== 1) throw new Error("Expected vector upsert");
if (vectorState.upserted[0].metadata.type !== "memory") throw new Error("Expected memory vector type");

vectorState.matches = [{ id: memory.vectorId, score: 0.91, metadata: {} }];
const recalled = await service.recall({ userId: "u1", query: "回答风格", topK: 3 });
if (recalled.length !== 1 || recalled[0].content !== "我喜欢简洁的回答") {
  throw new Error("Expected recalled memory");
}
if (vectorState.lastQuery.options.filter.type !== "memory") {
  throw new Error("Expected memory filter");
}

const conversationMemory = await service.writeConversationMemory({
  userId: "u1",
  userMessage: "我们正在开发记忆系统，需要讨论对话片段召回方案。",
  assistantReply: "可以增加 conversation_memory 类型，将重要对话片段写入 Vectorize 并在普通对话时召回。",
  sourceMessageId: "m2"
});
if (!conversationMemory || conversationMemory.kind !== "conversation") {
  throw new Error("Expected conversation memory");
}
if (vectorState.upserted.at(-1).metadata.type !== "conversation_memory") {
  throw new Error("Expected conversation memory vector type");
}

const conversationSummary = await service.writeConversationSummaryMemory({
  userId: "u1",
  summary: "阶段摘要（第 1-10 轮，窗口 10 轮，与上一阶段重叠 2 轮）：用户正在开发记忆系统，已确定保留即时对话片段，并新增每 10 轮一次、相邻摘要重叠 2 轮的阶段摘要。阶段摘要应基于总结文本生成向量。",
  sourceMessageId: "m20"
});
if (!conversationSummary || conversationSummary.kind !== "conversation_summary") {
  throw new Error("Expected conversation summary memory");
}
if (vectorState.upserted.at(-1).metadata.type !== "conversation_summary") {
  throw new Error("Expected conversation summary vector type");
}

vectorState.matches = [
  { id: memory.vectorId, score: 0.88, metadata: { type: "memory" } },
  { id: conversationMemory.vectorId, score: 0.9, metadata: { type: "conversation_memory" } },
  { id: conversationSummary.vectorId, score: 0.92, metadata: { type: "conversation_summary" } }
];
const mixedRecall = await service.recall({
  userId: "u1",
  query: "对话片段召回方案",
  topK: 5,
  types: ["memory", "conversation_memory", "conversation_summary"]
});
if (mixedRecall.length !== 3 || mixedRecall[0].kind !== "conversation_summary") {
  throw new Error("Expected mixed explicit, snippet, and summary memory recall");
}

const listed = await service.listMemories("u1");
if (listed.length !== 3) throw new Error("Expected listed memories");

const deleted = await service.deleteMemories({ userId: "u1", query: "忘记关于简洁回答的偏好" });
if (deleted.length !== 1) throw new Error("Expected deleted memory");
if (vectorState.deleted[0] !== memory.vectorId) throw new Error("Expected vector deletion");

console.log("memory service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
