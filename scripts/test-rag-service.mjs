import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-rag-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/rag-service.ts",
      "--bundle",
      "--format=esm",
      "--platform=browser",
      `--outfile=${join(tempDir, "rag-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { RagService } from "./rag-service.mjs";

const chunks = [
  {
    id: "chunk_precise",
    file_id: "file_1",
    user_id: "user_1",
    chunk_index: 2,
    content: "section: 文件上传限制\\n\\n单文件最大 25 MB，一次最多 12 个文件。上传后会写入 R2 和 D1。",
    vector_id: "vector_precise",
    token_estimate: 48,
    embedding_model: "@cf/baai/bge-m3",
    content_hash: "hash_precise",
    metadata_json: "{}",
    section_path: "文件管理 / 上传限制",
    char_start: null,
    char_end: null,
    parent_chunk_id: null,
    created_at: "2026-05-16 00:00:02"
  },
  {
    id: "chunk_broad",
    file_id: "file_1",
    user_id: "user_1",
    chunk_index: 1,
    content: "section: 文件管理\\n\\n用户可以上传文件，并在对话中列出文件。",
    vector_id: "vector_broad",
    token_estimate: 30,
    embedding_model: "@cf/baai/bge-m3",
    content_hash: "hash_broad",
    metadata_json: "{}",
    section_path: "文件管理",
    char_start: null,
    char_end: null,
    parent_chunk_id: null,
    created_at: "2026-05-16 00:00:01"
  },
  {
    id: "chunk_after",
    file_id: "file_1",
    user_id: "user_1",
    chunk_index: 3,
    content: "section: 文件上传后续\\n\\n上传完成后会进入后台索引，成功后状态变成 indexed。",
    vector_id: "vector_after",
    token_estimate: 34,
    embedding_model: "@cf/baai/bge-m3",
    content_hash: "hash_after",
    metadata_json: "{}",
    section_path: "文件管理 / 上传后续",
    char_start: null,
    char_end: null,
    parent_chunk_id: null,
    created_at: "2026-05-16 00:00:03"
  }
];

const files = [{
  id: "file_1",
  user_id: "user_1",
  r2_key: "users/user_1/files/file_1/progress.md",
  filename: "progress.md",
  content_type: "text/markdown",
  size: 1024,
  status: "indexed",
  processing_error: null,
  indexed_at: "2026-05-16 00:00:03",
  created_at: "2026-05-16 00:00:00",
  updated_at: "2026-05-16 00:00:03"
}];

const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.includes("FROM files") && sql.includes("user_id = ? AND id = ?")) {
              return files.find((file) => file.user_id === values[0] && file.id === values[1]) ?? null;
            }

            return null;
          },
          async all() {
            if (sql.includes("chunk_index >=")) {
              return {
                results: chunks
                  .filter((chunk) =>
                    chunk.user_id === values[0] &&
                    chunk.file_id === values[1] &&
                    chunk.chunk_index >= values[2] &&
                    chunk.chunk_index <= values[3]
                  )
                  .sort((left, right) => left.chunk_index - right.chunk_index)
              };
            }

            if (sql.includes("vector_id IN")) {
              const vectorIds = new Set(values.slice(1));
              return {
                results: chunks.filter((chunk) => chunk.user_id === values[0] && vectorIds.has(chunk.vector_id))
              };
            }

            if (sql.includes("FROM document_chunks") && sql.includes("INNER JOIN files")) {
              return {
                results: chunks.filter((chunk) => chunk.user_id === values[0])
              };
            }

            if (sql.includes("FROM document_chunks") && sql.includes("LIMIT")) {
              return {
                results: chunks
                  .filter((chunk) => chunk.user_id === values[0] && chunk.file_id === values[1])
                  .sort((left, right) => left.chunk_index - right.chunk_index)
                  .slice(0, values[2])
              };
            }

            if (sql.includes("FROM files") && sql.includes("id IN")) {
              const fileIds = new Set(values.slice(1));
              return {
                results: files.filter((file) => file.user_id === values[0] && fileIds.has(file.id))
              };
            }

            if (sql.includes("FROM files") && sql.includes("user_id = ? AND id = ?")) {
              return {
                results: files.filter((file) => file.user_id === values[0] && file.id === values[1])
              };
            }

            return { results: [] };
          }
        };
      }
    };
  }
};

const env = {
  DEFAULT_EMBEDDING_MODEL: "@cf/baai/bge-m3",
  VECTOR_DIMENSIONS: "1024",
  DB: db,
  AI: {
    async run(model, input) {
      if (model !== "@cf/baai/bge-m3") throw new Error("Expected bge-m3");
      const texts = Array.isArray(input.text) ? input.text : [input.text];
      return {
        data: texts.map(() => Array.from({ length: 1024 }, (_value, index) => index / 1024))
      };
    }
  },
  VECTORIZE: {
    async query(values, options) {
      if (values.length !== 1024) throw new Error("Expected query vector dimensions");
      if (options.filter.userId !== "user_1") throw new Error("Expected user filter");
      return {
        count: 2,
        matches: [
          { id: "vector_broad", score: 0.82, metadata: {} },
          { id: "vector_precise", score: 0.8, metadata: {} }
        ]
      };
    }
  }
};

const service = new RagService(env);
const result = await service.search({
  userId: "user_1",
  query: "上传文件大小限制是多少？"
});

if (result.chunks.length === 0) throw new Error("Expected RAG chunks");
if (result.chunks[0].chunk.id !== "chunk_precise") {
  throw new Error("Expected keyword fusion to promote precise upload limit chunk");
}
if (!result.contextText.includes("filename: progress.md")) {
  throw new Error("Expected filename in context");
}
if (!result.contextText.includes("25 MB")) {
  throw new Error("Expected relevant context content");
}
if (!result.contextText.includes("[neighbor chunk 1]")) {
  throw new Error("Expected previous neighbor chunk in expanded context");
}
if (!result.contextText.includes("[neighbor chunk 3]")) {
  throw new Error("Expected next neighbor chunk in expanded context");
}
if (!result.contextText.includes("[matched chunk 2]")) {
  throw new Error("Expected matched chunk marker in expanded context");
}

const summary = await service.summarizeFile({
  userId: "user_1",
  fileId: "file_1"
});

if (summary.file.filename !== "progress.md") throw new Error("Expected summary file");
if (summary.chunks.length !== chunks.length) throw new Error("Expected summary to use file chunks");
if (!summary.contextText.includes("上传完成后会进入后台索引")) {
  throw new Error("Expected summary context to include later file content");
}

console.log("rag service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
