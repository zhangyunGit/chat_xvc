import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-memory-route-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/routes/memories.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "memories.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { handleMemoriesRoute } from "./memories.mjs";

const memory = {
  id: "mem_1",
  user_id: "u1",
  content: "我喜欢先给结论",
  kind: "preference",
  vector_id: "memory:mem_1",
  source_message_id: null,
  confidence: 1,
  status: "active",
  embedding_model: "@cf/baai/bge-m3",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};
const memories = [memory];
const deletedVectorIds = [];

const env = {
  DB: {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (sql.includes("WHERE user_id = ? AND id = ?")) {
            const [userId, id] = this.values;
            return memories.find((item) => item.user_id === userId && item.id === id) ?? null;
          }
          throw new Error("Unexpected first SQL: " + sql);
        },
        async all() {
          if (sql.includes("status = 'active'")) {
            const [userId] = this.values;
            return { results: memories.filter((item) => item.user_id === userId && item.status === "active") };
          }
          if (sql.includes("id IN")) {
            const [userId, ...ids] = this.values;
            return { results: memories.filter((item) => item.user_id === userId && ids.includes(item.id)) };
          }
          throw new Error("Unexpected all SQL: " + sql);
        },
        async run() {
          if (sql.includes("UPDATE memories SET status = 'deleted'")) {
            const [userId, ...ids] = this.values;
            for (const item of memories) {
              if (item.user_id === userId && ids.includes(item.id)) item.status = "deleted";
            }
            return {};
          }
          throw new Error("Unexpected run SQL: " + sql);
        }
      };
    }
  },
  VECTORIZE: {
    async deleteByIds(ids) {
      deletedVectorIds.push(...ids);
    }
  },
  AI: {},
  DEFAULT_EMBEDDING_MODEL: "@cf/baai/bge-m3",
  VECTOR_DIMENSIONS: "1024"
};

const listResponse = await handleMemoriesRoute(new Request("https://example.com/api/memories?userId=u1"), env);
const listPayload = await listResponse.json();
if (!listResponse.ok || listPayload.memories.length !== 1) throw new Error("Expected memory list");
if (listPayload.memories[0].content !== "我喜欢先给结论") throw new Error("Expected public memory content");

const deleteResponse = await handleMemoriesRoute(new Request("https://example.com/api/memories/mem_1?userId=u1", { method: "DELETE" }), env);
const deletePayload = await deleteResponse.json();
if (!deleteResponse.ok || deletePayload.memory.id !== "mem_1") throw new Error("Expected deleted memory");
if (deletedVectorIds[0] !== "memory:mem_1") throw new Error("Expected vector deletion");

const emptyResponse = await handleMemoriesRoute(new Request("https://example.com/api/memories?userId=u1"), env);
const emptyPayload = await emptyResponse.json();
if (emptyPayload.memories.length !== 0) throw new Error("Expected empty memory list after delete");

console.log("memory route ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
