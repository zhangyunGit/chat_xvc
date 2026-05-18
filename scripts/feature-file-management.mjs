import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-feature-file-management-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/file-service.ts",
      "--bundle",
      "--format=esm",
      "--platform=browser",
      `--outfile=${join(tempDir, "file-service.mjs")}`
    ],
    { stdio: "inherit" }
  );
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/document-processing-service.ts",
      "--bundle",
      "--format=esm",
      "--platform=browser",
      `--outfile=${join(tempDir, "document-processing-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { FileService } from "./file-service.mjs";
import { DocumentProcessingService } from "./document-processing-service.mjs";

const files = [];
const chunks = [];
const r2Objects = new Map();
const vectorState = { upserted: [], deleted: [] };

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
          if (sql.startsWith("INSERT INTO users")) return {};

          if (sql.startsWith("INSERT INTO files")) {
            const [id, userId, r2Key, filename, contentType, size, status] = this.values;
            files.push({
              id,
              user_id: userId,
              r2_key: r2Key,
              filename,
              content_type: contentType,
              size,
              status,
              processing_error: null,
              indexed_at: null,
              created_at: "2026-05-17T00:00:00Z",
              updated_at: "2026-05-17T00:00:00Z"
            });
            return {};
          }

          if (sql.startsWith("UPDATE files SET")) {
            const [status, processingError, indexedAt, userId, fileId] = this.values;
            const file = files.find((item) => item.user_id === userId && item.id === fileId);
            if (file) {
              file.status = status;
              file.processing_error = processingError;
              if (indexedAt) file.indexed_at = indexedAt;
              file.updated_at = "2026-05-17T00:01:00Z";
            }
            return {};
          }

          if (sql.startsWith("DELETE FROM document_chunks")) {
            const [userId, fileId] = this.values;
            for (let index = chunks.length - 1; index >= 0; index -= 1) {
              if (chunks[index].user_id === userId && chunks[index].file_id === fileId) chunks.splice(index, 1);
            }
            return {};
          }

          if (sql.includes("INSERT INTO document_chunks")) {
            chunks.push({
              id: this.values[0],
              file_id: this.values[1],
              user_id: this.values[2],
              chunk_index: this.values[3],
              content: this.values[4],
              vector_id: this.values[5],
              token_estimate: this.values[6],
              embedding_model: this.values[7],
              content_hash: this.values[8],
              metadata_json: this.values[9],
              section_path: this.values[10],
              char_start: this.values[11],
              char_end: this.values[12],
              parent_chunk_id: this.values[13],
              created_at: "2026-05-17T00:00:00Z"
            });
            return {};
          }

          throw new Error("Unexpected run SQL: " + sql);
        },
        async first() {
          if (sql.includes("FROM users")) {
            return {
              id: this.values[0],
              email: null,
              name: null,
              ai_nickname: "XVC",
              profile_status: "pending",
              created_at: "2026-05-17T00:00:00Z",
              updated_at: "2026-05-17T00:00:00Z"
            };
          }

          if (sql === "SELECT * FROM files WHERE user_id = ? AND id = ?") {
            const [userId, fileId] = this.values;
            return files.find((file) => file.user_id === userId && file.id === fileId) ?? null;
          }

          if (sql === "SELECT * FROM files WHERE id = ?") {
            const [fileId] = this.values;
            return files.find((file) => file.id === fileId) ?? null;
          }

          return null;
        },
        async all() {
          if (sql.includes("FROM files WHERE user_id = ? AND status != 'deleted'")) {
            const [userId] = this.values;
            return { results: files.filter((file) => file.user_id === userId && file.status !== "deleted") };
          }

          if (sql.includes("FROM document_chunks")) {
            const [userId, fileId] = this.values;
            return {
              results: chunks
                .filter((chunk) => chunk.user_id === userId && chunk.file_id === fileId)
                .sort((a, b) => a.chunk_index - b.chunk_index)
            };
          }

          return { results: [] };
        }
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return statements.map(() => ({}));
    }
  };
}

const env = {
  DEFAULT_EMBEDDING_MODEL: "@cf/baai/bge-m3",
  VECTOR_DIMENSIONS: "1024",
  DB: createDb(),
  FILES: {
    async put(key, stream, options) {
      const bytes = await new Response(stream).arrayBuffer();
      r2Objects.set(key, { bytes, contentType: options.httpMetadata.contentType });
    },
    async get(key) {
      const object = r2Objects.get(key);
      if (!object) return null;
      return {
        async arrayBuffer() {
          return object.bytes;
        },
        async text() {
          return new TextDecoder().decode(object.bytes);
        }
      };
    },
    async delete(key) {
      r2Objects.delete(key);
    }
  },
  AI: {
    async run(model, input) {
      if (model !== "@cf/baai/bge-m3") throw new Error("Expected configured embedding model");
      const texts = Array.isArray(input.text) ? input.text : [input.text];
      return {
        data: texts.map((text, textIndex) =>
          Array.from({ length: 1024 }, (_value, dimension) => text.length / 1000 + textIndex + dimension / 1024)
        )
      };
    }
  },
  VECTORIZE: {
    async upsert(vectors) {
      vectorState.upserted.push(...vectors);
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
    async deleteByIds(ids) {
      vectorState.deleted.push(...ids);
      return { ids, count: ids.length };
    }
  }
};

const fileService = new FileService(env);
const upload = await fileService.uploadFiles({
  userId: "feature-user",
  files: [
    new File([
      "# 文件功能测试\\n\\n上传后的文档需要被解析、切片并写入向量库。\\n\\n## 删除\\n\\n删除文件时要清理 R2、D1 chunk 和 Vectorize 向量。"
    ], "feature-notes.md", { type: "text/markdown" })
  ]
});

if (upload.files.length !== 1) throw new Error("Expected one uploaded file");
const uploadedFile = upload.files[0];
if (uploadedFile.status !== "uploaded") throw new Error("Expected uploaded status");
if (!r2Objects.has(uploadedFile.r2Key)) throw new Error("Expected object in R2 mock");

const processing = await new DocumentProcessingService(env).processFile(uploadedFile.id);
if (processing.status !== "indexed") throw new Error("Expected indexed processing status");
if (chunks.length === 0) throw new Error("Expected stored document chunks");
if (vectorState.upserted.length !== chunks.length) throw new Error("Expected vector upsert for each chunk");
if (files[0].status !== "indexed" || !files[0].indexed_at) throw new Error("Expected indexed file metadata");

const listed = await fileService.listFiles("feature-user");
if (listed.length !== 1 || listed[0].filename !== "feature-notes.md") throw new Error("Expected listed indexed file");

const deleted = await fileService.deleteFile({ userId: "feature-user", fileId: uploadedFile.id });
if (deleted.status !== "deleted") throw new Error("Expected deleted status");
if (r2Objects.has(uploadedFile.r2Key)) throw new Error("Expected R2 object deletion");
if (chunks.length !== 0) throw new Error("Expected chunk cleanup");
if (vectorState.deleted.length !== vectorState.upserted.length) throw new Error("Expected vector cleanup");

const afterDelete = await fileService.listFiles("feature-user");
if (afterDelete.length !== 0) throw new Error("Deleted file should not be listed");

console.log("feature file management ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
