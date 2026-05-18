import { DocumentChunkRepository } from "../repositories/document-chunk-repository";
import { FileRepository } from "../repositories/file-repository";
import { VectorRepository } from "../repositories/vector-repository";
import { WorkersAiProvider } from "../providers/workers-ai-provider";
import { RagRankingService, type RankedRagChunk, type RagRankCandidate } from "./rag-ranking-service";
import type { UploadedFile } from "../types/domain";

export type ExpandedRagChunk = RankedRagChunk & {
  contextChunks: RankedRagChunk["chunk"][];
};

export type RagSearchResult = {
  chunks: ExpandedRagChunk[];
  contextText: string;
};

export type RagSummarizeResult = {
  file: UploadedFile;
  chunks: ExpandedRagChunk[];
  contextText: string;
};

const semanticTopK = 20;
const keywordPoolLimit = 200;
const finalChunkLimit = 8;
const neighborWindow = 1;

export class RagService {
  private readonly chunkRepository: DocumentChunkRepository;
  private readonly embeddingProvider: WorkersAiProvider;
  private readonly fileRepository: FileRepository;
  private readonly rankingService = new RagRankingService();
  private readonly vectorRepository: VectorRepository;

  constructor(private readonly env: Env) {
    this.chunkRepository = new DocumentChunkRepository(env.DB);
    this.embeddingProvider = new WorkersAiProvider(env);
    this.fileRepository = new FileRepository(env.DB);
    this.vectorRepository = new VectorRepository(env.VECTORIZE);
  }

  async search(input: {
    userId: string;
    query: string;
  }): Promise<RagSearchResult> {
    const queryEmbedding = await this.embeddingProvider.embed([input.query]);
    const vector = queryEmbedding[0];
    const expectedDimensions = Number(this.env.VECTOR_DIMENSIONS);

    if (!vector) {
      throw new Error("Failed to generate query embedding");
    }

    if (expectedDimensions && vector.length !== expectedDimensions) {
      throw new Error(
        `Query embedding dimension mismatch for ${this.env.DEFAULT_EMBEDDING_MODEL}: expected ${expectedDimensions}, got ${vector.length}`
      );
    }

    const vectorMatches = await this.vectorRepository.query({
      values: vector,
      userId: input.userId,
      topK: semanticTopK
    });

    const vectorChunks = await this.chunkRepository.listByVectorIds(
      input.userId,
      vectorMatches.map((match) => match.id)
    );
    const vectorScoreById = new Map(vectorMatches.map((match) => [match.id, match.score]));
    const semanticCandidates: RagRankCandidate[] = vectorChunks.map((chunk) => ({
      chunk,
      vectorScore: vectorScoreById.get(chunk.vectorId)
    }));

    const keywordChunks = await this.chunkRepository.listRecentIndexedByUser(input.userId, keywordPoolLimit);
    const allFileIds = unique([...vectorChunks, ...keywordChunks].map((chunk) => chunk.fileId));
    const files = await this.fileRepository.listByIds(input.userId, allFileIds);
    const filenameById = new Map(files.map((file) => [file.id, file.filename]));
    const semanticCandidatesWithFiles = semanticCandidates.map((candidate) => ({
      ...candidate,
      filename: filenameById.get(candidate.chunk.fileId)
    }));
    const keywordCandidates: RagRankCandidate[] = keywordChunks.map((chunk) => ({
      chunk,
      filename: filenameById.get(chunk.fileId)
    }));
    const ranked = this.rankingService
      .rank(input.query, [...semanticCandidatesWithFiles, ...keywordCandidates])
      .slice(0, finalChunkLimit);
    const expanded = await this.expandWithNeighborChunks(input.userId, ranked);

    return {
      chunks: expanded,
      contextText: createRagContextText(expanded)
    };
  }

  async summarizeFile(input: {
    userId: string;
    fileId: string;
    maxChunks?: number;
  }): Promise<RagSummarizeResult> {
    const file = await this.fileRepository.findById(input.userId, input.fileId);
    if (!file || file.status === "deleted") {
      throw new Error("File not found");
    }

    const chunks = await this.chunkRepository.listByFileLimited({
      userId: input.userId,
      fileId: input.fileId,
      limit: input.maxChunks ?? 24
    });

    if (chunks.length === 0) {
      throw new Error(`File ${file.filename} has no indexed chunks yet`);
    }

    const expanded = chunks.map((chunk, index): ExpandedRagChunk => ({
      chunk,
      contextChunks: [chunk],
      filename: file.filename,
      keywordScore: 0,
      finalScore: 1 - index / Math.max(chunks.length, 1)
    }));

    return {
      file,
      chunks: expanded,
      contextText: createRagContextText(expanded)
    };
  }

  private async expandWithNeighborChunks(userId: string, chunks: RankedRagChunk[]): Promise<ExpandedRagChunk[]> {
    return Promise.all(
      chunks.map(async (item) => {
        const contextChunks = await this.chunkRepository.listByFileAndChunkIndexRange({
          userId,
          fileId: item.chunk.fileId,
          startIndex: Math.max(0, item.chunk.chunkIndex - neighborWindow),
          endIndex: item.chunk.chunkIndex + neighborWindow
        });

        return {
          ...item,
          contextChunks: contextChunks.length > 0 ? contextChunks : [item.chunk]
        };
      })
    );
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function createRagContextText(chunks: ExpandedRagChunk[]): string {
  if (chunks.length === 0) {
    return "没有检索到可用的文档片段。";
  }

  return chunks
    .map((item, index) => {
      const section = item.chunk.sectionPath ? `\nsection: ${item.chunk.sectionPath}` : "";
      const expandedContext = item.contextChunks
        .map((chunk) => {
          const marker = chunk.id === item.chunk.id ? "matched" : "neighbor";
          const chunkSection = chunk.sectionPath ? `\nsection: ${chunk.sectionPath}` : "";

          return [
            `[${marker} chunk ${chunk.chunkIndex}]`,
            chunkSection,
            chunk.content
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");

      return [
        `[source ${index + 1}]`,
        `filename: ${item.filename ?? "unknown"}`,
        `fileId: ${item.chunk.fileId}`,
        `chunkId: ${item.chunk.id}`,
        `chunkIndex: ${item.chunk.chunkIndex}`,
        `score: ${item.finalScore.toFixed(4)}`,
        section,
        "expandedContext:",
        expandedContext
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}
