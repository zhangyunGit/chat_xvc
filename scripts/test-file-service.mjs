import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-file-service-"));

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

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { FileService } from "./file-service.mjs";

const inserted = [];
const chunks = [];
const deletedR2Keys = [];
const deletedVectorIds = [];
const env = {
  FILES: {
    async put(key, stream, options) {
      if (!key.includes("/demo.txt")) throw new Error("Expected filename in R2 key");
      if (!options.httpMetadata.contentType.includes("text/plain")) throw new Error("Expected content type");
      await stream.cancel();
    },
    async delete(key) {
      deletedR2Keys.push(key);
    }
  },
  VECTORIZE: {
    async deleteByIds(ids) {
      deletedVectorIds.push(...ids);
      return { ids, count: ids.length };
    }
  },
  DB: {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.startsWith("INSERT INTO users")) return {};
              if (sql.startsWith("INSERT INTO files")) {
                inserted.push({
                  id: values[0],
                  user_id: values[1],
                  r2_key: values[2],
                  filename: values[3],
                  content_type: values[4],
                  size: values[5],
                  status: values[6],
                  processing_error: null,
                  indexed_at: null,
                  created_at: "2026-05-16 00:00:00",
                  updated_at: "2026-05-16 00:00:00"
                });
              }
              if (sql.startsWith("UPDATE files")) {
                const file = inserted.find((item) => item.user_id === values[3] && item.id === values[4]);
                if (file) {
                  file.status = values[0];
                  file.processing_error = values[1];
                  if (values[2]) file.indexed_at = values[2];
                  file.updated_at = "2026-05-16 00:01:00";
                }
              }
              if (sql.startsWith("DELETE FROM document_chunks")) {
                for (let index = chunks.length - 1; index >= 0; index -= 1) {
                  if (chunks[index].user_id === values[0] && chunks[index].file_id === values[1]) {
                    chunks.splice(index, 1);
                  }
                }
              }
              return {};
            },
            async first() {
              if (sql.includes("FROM users")) {
                return {
                  id: values[0],
                  email: null,
                  name: null,
                  ai_nickname: "XVC",
                  profile_status: "pending",
                  created_at: "2026-05-16 00:00:00",
                  updated_at: "2026-05-16 00:00:00"
                };
              }
              if (sql.includes("FROM files")) return inserted[0] ?? null;
              return null;
            },
            async all() {
              if (sql.includes("FROM document_chunks")) {
                return {
                  results: chunks.filter((chunk) => chunk.user_id === values[0] && chunk.file_id === values[1])
                };
              }
              return { results: inserted.filter((file) => file.status !== "deleted") };
            }
          };
        }
      };
    }
  }
};

const service = new FileService(env);
const result = await service.uploadFiles({
  userId: "user_1",
  files: [new File(["hello"], "demo.txt", { type: "text/plain" })]
});

if (result.userId !== "user_1") throw new Error("Expected user id");
if (result.files.length !== 1) throw new Error("Expected one file");
if (result.files[0].filename !== "demo.txt") throw new Error("Expected filename");
if (result.files[0].status !== "uploaded") throw new Error("Expected uploaded status");

const listed = await service.listFiles("user_1");
if (listed.length !== 1) throw new Error("Expected listed file");

chunks.push({
  id: "chunk_1",
  file_id: result.files[0].id,
  user_id: "user_1",
  chunk_index: 0,
  content: "hello",
  vector_id: "vector_1",
  token_estimate: 3,
  embedding_model: "@cf/baai/bge-m3",
  content_hash: "hash_1",
  metadata_json: "{}",
  section_path: null,
  char_start: null,
  char_end: null,
  parent_chunk_id: null,
  created_at: "2026-05-16 00:00:00"
});

const deleted = await service.deleteFile({
  userId: "user_1",
  fileId: result.files[0].id
});

if (deleted.status !== "deleted") throw new Error("Expected deleted status");
if (deletedR2Keys.length !== 1) throw new Error("Expected R2 object deletion");
if (deletedVectorIds[0] !== "vector_1") throw new Error("Expected vector deletion");
if (chunks.length !== 0) throw new Error("Expected chunk deletion");

console.log("file service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
