import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-document-processing-"));
const docxBytes = zipSync({
  "word/document.xml": strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>第一段 Word 文档内容</w:t></w:r></w:p>
        <w:p><w:r><w:t>第二段包含 &amp; XML 实体</w:t></w:r></w:p>
      </w:body>
    </w:document>`
  )
});
const docxBase64 = Buffer.from(docxBytes).toString("base64");

try {
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
import {
  DocumentProcessingService,
  createDocumentChunks,
  extractDocumentText
} from "./document-processing-service.mjs";

const markdownChunks = createDocumentChunks({
  filename: "plan.md",
  contentType: "text/markdown",
  text: "# 文件管理\\n\\n这里记录上传、切片、向量化。\\n\\n## 限制\\n\\n单文件最大 25 MB，一次最多 12 个文件。"
});

if (markdownChunks.length === 0) throw new Error("Expected markdown chunks");
if (!markdownChunks.some((chunk) => chunk.sectionPath?.includes("文件管理"))) {
  throw new Error("Expected markdown section path");
}

const jsonChunks = createDocumentChunks({
  filename: "requirements.json",
  contentType: "application/json",
  text: JSON.stringify({ product: { requirements: [{ title: "支持文件上传" }] } })
});

if (!jsonChunks[0].content.includes("path: product.requirements[0].title")) {
  throw new Error("Expected JSON path text");
}

const docxBuffer = Uint8Array.from(atob("${docxBase64}"), (char) => char.charCodeAt(0)).buffer;
const docxText = await extractDocumentText({
  filename: "demo.docx",
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: docxBuffer
});

if (!docxText.includes("第一段 Word 文档内容")) throw new Error("Expected DOCX paragraph text");
if (!docxText.includes("第二段包含 & XML 实体")) throw new Error("Expected decoded DOCX XML entity");

const files = [{
  id: "file_1",
  user_id: "user_1",
  r2_key: "users/user_1/files/file_1/plan.md",
  filename: "plan.md",
  content_type: "text/markdown",
  size: 128,
  status: "uploaded",
  processing_error: null,
  indexed_at: null,
  created_at: "2026-05-16 00:00:00",
  updated_at: "2026-05-16 00:00:00"
}];
const chunks = [];
const vectorState = {
  deleted: [],
  upserted: []
};

const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async run() {
            if (sql.startsWith("UPDATE files")) {
              const file = files.find((item) => item.user_id === values[3] && item.id === values[4]);
              if (file) {
                file.status = values[0];
                file.processing_error = values[1];
                if (values[2]) file.indexed_at = values[2];
              }
            }

            if (sql.startsWith("DELETE FROM document_chunks")) {
              for (let index = chunks.length - 1; index >= 0; index -= 1) {
                if (chunks[index].user_id === values[0] && chunks[index].file_id === values[1]) {
                  chunks.splice(index, 1);
                }
              }
            }

            if (sql.includes("INSERT INTO document_chunks")) {
              chunks.push({
                id: values[0],
                file_id: values[1],
                user_id: values[2],
                chunk_index: values[3],
                content: values[4],
                vector_id: values[5],
                token_estimate: values[6],
                embedding_model: values[7],
                content_hash: values[8],
                metadata_json: values[9],
                section_path: values[10],
                char_start: values[11],
                char_end: values[12],
                parent_chunk_id: values[13],
                created_at: "2026-05-16 00:00:00"
              });
            }

            return {};
          },
          async first() {
            if (sql.includes("FROM files WHERE id = ?")) {
              return files.find((item) => item.id === values[0]) ?? null;
            }
            if (sql.includes("FROM files WHERE user_id = ? AND id = ?")) {
              return files.find((item) => item.user_id === values[0] && item.id === values[1]) ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM document_chunks")) {
              return {
                results: chunks
                  .filter((item) => item.user_id === values[0] && item.file_id === values[1])
                  .sort((a, b) => a.chunk_index - b.chunk_index)
              };
            }

            return { results: [] };
          }
        };
      }
    };
  },
  async batch(statements) {
    for (const statement of statements) {
      await statement.run();
    }
    return statements.map(() => ({}));
  }
};

const env = {
  DEFAULT_EMBEDDING_MODEL: "@cf/baai/bge-m3",
  VECTOR_DIMENSIONS: "1024",
  DB: db,
  FILES: {
    async get(key) {
      if (!key.includes("plan.md")) return null;
      return {
        async arrayBuffer() {
          return new TextEncoder().encode("# 文件管理\\n\\n这里记录上传、切片、向量化。\\n\\n## 限制\\n\\n单文件最大 25 MB，一次最多 12 个文件。").buffer;
        },
        async text() {
          return "# 文件管理\\n\\n这里记录上传、切片、向量化。\\n\\n## 限制\\n\\n单文件最大 25 MB，一次最多 12 个文件。";
        }
      };
    }
  },
  AI: {
    async run(model, input) {
      if (model !== "@cf/baai/bge-m3") throw new Error("Expected bge-m3");
      const texts = Array.isArray(input.text) ? input.text : [input.text];
      return {
        data: texts.map((_, index) => Array.from({ length: 1024 }, (_value, dimension) => index + dimension / 1024))
      };
    }
  },
  VECTORIZE: {
    async deleteByIds(ids) {
      vectorState.deleted.push(...ids);
      return { ids, count: ids.length };
    },
    async upsert(vectors) {
      vectorState.upserted.push(...vectors);
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    }
  }
};

const service = new DocumentProcessingService(env);
const result = await service.processFile("file_1");

if (result.status !== "indexed") throw new Error("Expected indexed result");
if (result.chunkCount !== chunks.length) throw new Error("Expected chunk count to match stored chunks");
if (files[0].status !== "indexed") throw new Error("Expected file status indexed");
if (!files[0].indexed_at) throw new Error("Expected indexed_at");
if (chunks.length === 0) throw new Error("Expected stored chunks");
if (vectorState.upserted.length !== chunks.length) throw new Error("Expected vector upsert per chunk");
if (vectorState.upserted[0].values.length !== 1024) throw new Error("Expected 1024-dimensional vector");
if (chunks[0].embedding_model !== "@cf/baai/bge-m3") throw new Error("Expected embedding model on chunk");

console.log("document processing ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
