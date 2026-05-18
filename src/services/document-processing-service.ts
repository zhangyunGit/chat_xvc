import { DocumentChunkRepository } from "../repositories/document-chunk-repository";
import { FileRepository } from "../repositories/file-repository";
import { VectorRepository } from "../repositories/vector-repository";
import { WorkersAiProvider } from "../providers/workers-ai-provider";
import type { CreateDocumentChunkInput, UploadedFile } from "../types/domain";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { strFromU8, unzipSync } from "fflate";

type ChunkDraft = {
  content: string;
  tokenEstimate: number;
  sectionPath?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  metadata: Record<string, string | number | boolean>;
};

type ProcessDocumentResult = {
  fileId: string;
  status: "indexed" | "failed";
  chunkCount: number;
  error?: string;
};

const childChunkMaxTokens = 350;
const childChunkMinTokens = 180;
const childChunkOverlapTokens = 70;
const embeddingBatchSize = 16;

export class DocumentProcessingService {
  private readonly chunkRepository: DocumentChunkRepository;
  private readonly embeddingProvider: WorkersAiProvider;
  private readonly fileRepository: FileRepository;
  private readonly vectorRepository: VectorRepository;

  constructor(private readonly env: Env) {
    this.chunkRepository = new DocumentChunkRepository(env.DB);
    this.embeddingProvider = new WorkersAiProvider(env);
    this.fileRepository = new FileRepository(env.DB);
    this.vectorRepository = new VectorRepository(env.VECTORIZE);
  }

  async processFile(fileId: string): Promise<ProcessDocumentResult> {
    const file = await this.fileRepository.findByIdForUserlessLookup(fileId);
    if (!file) {
      return {
        fileId,
        status: "failed",
        chunkCount: 0,
        error: "File record not found"
      };
    }

    try {
      await this.fileRepository.updateStatus({
        userId: file.userId,
        fileId: file.id,
        status: "processing",
        processingError: null
      });

      const result = await this.indexFile(file);

      await this.fileRepository.updateStatus({
        userId: file.userId,
        fileId: file.id,
        status: "indexed",
        processingError: null,
        indexedAt: new Date().toISOString()
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document processing failed";

      await this.fileRepository.updateStatus({
        userId: file.userId,
        fileId: file.id,
        status: "failed",
        processingError: message.slice(0, 500)
      });

      return {
        fileId: file.id,
        status: "failed",
        chunkCount: 0,
        error: message
      };
    }
  }

  private async indexFile(file: UploadedFile): Promise<ProcessDocumentResult> {
    const object = await this.env.FILES.get(file.r2Key);
    if (!object) {
      throw new Error("Original file object not found in R2");
    }

    const buffer = await object.arrayBuffer();
    const text = await extractDocumentText({
      filename: file.filename,
      contentType: file.contentType,
      buffer
    });
    const chunks = createDocumentChunks({
      filename: file.filename,
      contentType: file.contentType,
      text
    });

    if (chunks.length === 0) {
      throw new Error("No indexable text found in file");
    }

    const embeddingModel = this.env.DEFAULT_EMBEDDING_MODEL;
    const expectedDimensions = Number(this.env.VECTOR_DIMENSIONS);
    const chunkInputs: CreateDocumentChunkInput[] = [];
    const vectorInputs = [];

    for (let start = 0; start < chunks.length; start += embeddingBatchSize) {
      const batch = chunks.slice(start, start + embeddingBatchSize);
      const vectors = await this.embeddingProvider.embed(batch.map((chunk) => chunk.content));

      if (vectors.length !== batch.length) {
        throw new Error(`Embedding result count mismatch: expected ${batch.length}, got ${vectors.length}`);
      }

      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index];
        const values = vectors[index];

        if (expectedDimensions && values.length !== expectedDimensions) {
          throw new Error(
            `Embedding dimension mismatch for ${embeddingModel}: expected ${expectedDimensions}, got ${values.length}`
          );
        }

        const chunkIndex = start + index;
        const chunkId = crypto.randomUUID();
        const vectorId = `file:${file.id}:chunk:${chunkIndex}`;
        const contentHash = await sha256Hex(chunk.content);

        chunkInputs.push({
          id: chunkId,
          fileId: file.id,
          userId: file.userId,
          chunkIndex,
          content: chunk.content,
          vectorId,
          tokenEstimate: chunk.tokenEstimate,
          embeddingModel,
          contentHash,
          metadataJson: JSON.stringify(chunk.metadata),
          sectionPath: chunk.sectionPath ?? null,
          charStart: chunk.charStart ?? null,
          charEnd: chunk.charEnd ?? null,
          parentChunkId: null
        });

        vectorInputs.push({
          id: vectorId,
          values,
          metadata: {
            type: "document",
            userId: file.userId,
            fileId: file.id,
            chunkId,
            filename: file.filename,
            chunkIndex,
            contentType: file.contentType ?? "application/octet-stream",
            embeddingModel,
            sectionPath: chunk.sectionPath ?? ""
          }
        });
      }
    }

    await this.assertFileNotDeleted(file);

    const existingChunks = await this.chunkRepository.listByFile(file.userId, file.id);
    await this.vectorRepository.deleteByIds(existingChunks.map((chunk) => chunk.vectorId));
    await this.vectorRepository.upsert(vectorInputs);
    if (await this.wasFileDeleted(file)) {
      await this.vectorRepository.deleteByIds(vectorInputs.map((vector) => vector.id));
      throw new Error("File was deleted before indexing completed");
    }
    await this.chunkRepository.replaceForFile({
      userId: file.userId,
      fileId: file.id,
      chunks: chunkInputs
    });

    return {
      fileId: file.id,
      status: "indexed",
      chunkCount: chunkInputs.length
    };
  }

  private async assertFileNotDeleted(file: UploadedFile): Promise<void> {
    if (await this.wasFileDeleted(file)) {
      throw new Error("File was deleted before indexing completed");
    }
  }

  private async wasFileDeleted(file: UploadedFile): Promise<boolean> {
    const current = await this.fileRepository.findById(file.userId, file.id);
    return !current || current.status === "deleted";
  }
}

export function createDocumentChunks(input: {
  filename: string;
  contentType: string | null;
  text: string;
}): ChunkDraft[] {
  const sourceType = detectSourceType(input.filename, input.contentType);

  if (!sourceType) {
    throw new Error(`Unsupported file type for indexing: ${input.contentType ?? input.filename}`);
  }

  if (sourceType === "json") {
    return splitTextIntoChunks(jsonToPathText(input.text), {
      sourceType,
      sectionPath: "JSON"
    });
  }

  if (sourceType === "csv") {
    return splitTextIntoChunks(csvToRowText(input.text), {
      sourceType,
      sectionPath: "CSV"
    });
  }

  if (sourceType === "markdown") {
    return splitMarkdownIntoChunks(input.text);
  }

  return splitTextIntoChunks(input.text, {
    sourceType,
    sectionPath: null
  });
}

export async function extractDocumentText(input: {
  filename: string;
  contentType: string | null;
  buffer: ArrayBuffer;
}): Promise<string> {
  const sourceType = detectSourceType(input.filename, input.contentType);
  const bytes = new Uint8Array(input.buffer);

  if (sourceType === "pdf") {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractPdfText(pdf, { mergePages: true });
    return result.text;
  }

  if (sourceType === "docx") {
    return extractDocxText(bytes);
  }

  if (sourceType === "legacy-doc") {
    throw new Error("Legacy .doc files are not supported. Please upload .docx, PDF, TXT, Markdown, JSON, or CSV.");
  }

  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 2));
}

function splitMarkdownIntoChunks(text: string): ChunkDraft[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ sectionPath: string | null; content: string }> = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let currentLines: string[] = [];

  function flush() {
    const content = currentLines.join("\n").trim();
    if (!content) return;

    sections.push({
      sectionPath: headingStack.map((item) => item.title).join(" / ") || null,
      content
    });
    currentLines = [];
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const title = heading[2].trim();

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      headingStack.push({ level, title });
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  flush();

  return sections.flatMap((section) =>
    splitTextIntoChunks(section.content, {
      sourceType: "markdown",
      sectionPath: section.sectionPath
    })
  );
}

function splitTextIntoChunks(
  text: string,
  options: {
    sourceType: string;
    sectionPath: string | null;
  }
): ChunkDraft[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const prefix = options.sectionPath ? `section: ${options.sectionPath}\n\n` : "";
  const units = splitIntoSemanticUnits(normalized);
  const chunks: ChunkDraft[] = [];
  let current = "";
  let previousOverlap = "";

  function pushCurrent() {
    const trimmed = current.trim();
    if (!trimmed) return;

    const content = `${prefix}${previousOverlap}${trimmed}`.trim();
    chunks.push({
      content,
      tokenEstimate: estimateTokens(content),
      sectionPath: options.sectionPath,
      metadata: {
        sourceType: options.sourceType
      }
    });

    previousOverlap = createOverlap(trimmed);
    current = "";
  }

  for (const unit of units) {
    if (estimateTokens(unit) > childChunkMaxTokens) {
      pushCurrent();
      const hardChunks = hardSplit(unit);
      for (const hardChunk of hardChunks) {
        current = hardChunk;
        pushCurrent();
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (
      current &&
      estimateTokens(candidate) > childChunkMaxTokens &&
      estimateTokens(current) >= childChunkMinTokens
    ) {
      pushCurrent();
      current = unit;
    } else {
      current = candidate;
    }
  }

  pushCurrent();

  return chunks;
}

function splitIntoSemanticUnits(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return [];
      if (estimateTokens(trimmed) <= childChunkMaxTokens) return [trimmed];

      return trimmed
        .split(/(?<=[。！？!?；;])\s*/)
        .map((item) => item.trim())
        .filter(Boolean);
    })
    .filter(Boolean);
}

function hardSplit(text: string): string[] {
  const maxChars = childChunkMaxTokens * 2;
  const overlapChars = childChunkOverlapTokens * 2;
  const chunks: string[] = [];

  for (let start = 0; start < text.length; start += maxChars - overlapChars) {
    chunks.push(text.slice(start, start + maxChars).trim());
  }

  return chunks.filter(Boolean);
}

function createOverlap(text: string): string {
  const overlapChars = childChunkOverlapTokens * 2;
  if (text.length <= overlapChars) return `${text}\n\n`;

  return `${text.slice(-overlapChars)}\n\n`;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function detectSourceType(
  filename: string,
  contentType: string | null
): "markdown" | "text" | "json" | "csv" | "pdf" | "docx" | "legacy-doc" | null {
  const lowerName = filename.toLowerCase();
  const lowerType = (contentType ?? "").toLowerCase();

  if (lowerName.endsWith(".pdf") || lowerType.includes("pdf")) {
    return "pdf";
  }

  if (
    lowerName.endsWith(".docx") ||
    lowerType.includes("officedocument.wordprocessingml.document")
  ) {
    return "docx";
  }

  if (lowerName.endsWith(".doc") || lowerType === "application/msword") {
    return "legacy-doc";
  }

  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || lowerType.includes("markdown")) {
    return "markdown";
  }

  if (lowerName.endsWith(".json") || lowerType.includes("json")) {
    return "json";
  }

  if (lowerName.endsWith(".csv") || lowerType.includes("csv")) {
    return "csv";
  }

  if (lowerName.endsWith(".txt") || lowerType.startsWith("text/")) {
    return "text";
  }

  return null;
}

function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const xmlPaths = Object.keys(files)
    .filter((path) =>
      /^word\/(document|footnotes|endnotes)\.xml$/i.test(path) ||
      /^word\/(header|footer)\d+\.xml$/i.test(path)
    )
    .sort((left, right) => {
      if (left === "word/document.xml") return -1;
      if (right === "word/document.xml") return 1;
      return left.localeCompare(right);
    });

  const paragraphs = xmlPaths.flatMap((path) => extractParagraphsFromWordXml(strFromU8(files[path])));
  const text = paragraphs.join("\n\n").trim();

  if (!text) {
    throw new Error("No extractable text found in DOCX file");
  }

  return text;
}

function extractParagraphsFromWordXml(xml: string): string[] {
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];

  return paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/<w:tab\b[^>]*\/>/g, "\t")
        .replace(/<w:br\b[^>]*\/>/g, "\n")
        .replace(/<\/w:t>\s*<w:t\b[^>]*>/g, "")
        .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_match, value: string) => decodeXmlEntities(value))
        .replace(/<[^>]+>/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    )
    .filter(Boolean);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function jsonToPathText(text: string): string {
  const parsed = JSON.parse(text) as unknown;
  const rows: string[] = [];

  function visit(value: unknown, path: string) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push(`path: ${path}\nvalue: ${String(value)}`);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        visit(item, path ? `${path}.${key}` : key);
      }
    }
  }

  visit(parsed, "");
  return rows.join("\n\n");
}

function csvToRowText(text: string): string {
  const lines = normalizeText(text).split("\n").filter(Boolean);
  if (lines.length === 0) return "";

  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const fields = headers.map((header, fieldIndex) => `${header}: ${values[fieldIndex] ?? ""}`).join("; ");

    return `row ${index + 1}: ${fields}`;
  });

  return [`columns: ${headers.join(", ")}`, ...rows].join("\n");
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
