import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-feature-memory-management-"));

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
import { MemoryService } from "./memory-service.mjs";

const memories = [];
const vectorState = { upserted: [], deleted: [], matches: [], lastQueries: [] };

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
              created_at: "2026-05-17T00:00:00Z",
              updated_at: "2026-05-17T00:00:00Z"
            });
            return {};
          }

          if (sql.includes("UPDATE memories SET status = 'deleted'")) {
            const [userId, ...ids] = this.values;
            for (const memory of memories) {
              if (memory.user_id === userId && ids.includes(memory.id)) {
                memory.status = "deleted";
                memory.updated_at = "2026-05-17T00:01:00Z";
              }
            }
            return {};
          }

          throw new Error("Unexpected run SQL: " + sql);
        },
        async first() {
          if (sql === "SELECT * FROM memories WHERE user_id = ? AND id = ?") {
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
      if (model !== "@cf/baai/bge-m3") throw new Error("Expected configured embedding model");
      return {
        data: input.text.map((text) => {
          const seed = text.length / 100;
          return [seed, seed + 0.1, seed + 0.2, seed + 0.3];
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
      vectorState.lastQueries.push({ values, options });
      const type = options?.filter?.type;
      return {
        matches: vectorState.matches.filter((match) => !type || match.metadata?.type === type)
      };
    }
  }
};

const service = new MemoryService(env);
const userId = "feature-user";

const explicitMemory = await service.writeMemory({
  userId,
  message: "请记住：我喜欢回答先给结论，再给必要步骤",
  sourceMessageId: "msg-1"
});
if (explicitMemory.kind !== "preference") throw new Error("Expected preference memory");
if (vectorState.upserted[0].metadata.type !== "memory") throw new Error("Expected explicit memory vector");

const conversationMemory = await service.writeConversationMemory({
  userId,
  userMessage: "我们正在做功能测试脚本，希望每个脚本可以独立重复运行。",
  assistantReply: "可以用临时目录打包服务层，并通过本地 mock D1、R2、Vectorize、LLM 来保持测试可重复。",
  sourceMessageId: "msg-2"
});
if (!conversationMemory || conversationMemory.kind !== "conversation") throw new Error("Expected conversation memory");
if (vectorState.upserted.at(-1).metadata.type !== "conversation_memory") {
  throw new Error("Expected conversation memory vector");
}

vectorState.matches = [
  { id: explicitMemory.vectorId, score: 0.93, metadata: { type: "memory" } },
  { id: conversationMemory.vectorId, score: 0.89, metadata: { type: "conversation_memory" } }
];
const recalled = await service.recall({
  userId,
  query: "我的回答偏好和功能测试方案是什么",
  topK: 5,
  types: ["memory", "conversation_memory"]
});
if (recalled.length !== 2) throw new Error("Expected mixed memory recall");
if (!recalled.some((memory) => memory.content.includes("先给结论"))) throw new Error("Expected explicit preference recall");
if (!recalled.some((memory) => memory.kind === "conversation")) throw new Error("Expected conversation snippet recall");

const listed = await service.listMemories(userId);
if (listed.length !== 2) throw new Error("Expected active memory list");

const deleted = await service.deleteMemories({ userId, query: "忘记关于先给结论的偏好" });
if (deleted.length !== 1) throw new Error("Expected one deleted memory");
if (deleted[0].id !== explicitMemory.id) throw new Error("Expected preference memory deletion");
if (vectorState.deleted[0] !== explicitMemory.vectorId) throw new Error("Expected vector deletion");

const remaining = await service.listMemories(userId);
if (remaining.length !== 1 || remaining[0].id !== conversationMemory.id) throw new Error("Expected only conversation memory to remain");

console.log("feature memory management ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
