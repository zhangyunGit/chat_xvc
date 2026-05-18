import type { CreateDocumentChunkInput, DocumentChunk } from "../types/domain";

type DocumentChunkRow = {
  id: string;
  file_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  vector_id: string;
  token_estimate: number | null;
  embedding_model?: string | null;
  content_hash?: string | null;
  metadata_json?: string | null;
  section_path?: string | null;
  char_start?: number | null;
  char_end?: number | null;
  parent_chunk_id?: string | null;
  created_at: string;
};

export class DocumentChunkRepository {
  constructor(private readonly db: D1Database) {}

  async replaceForFile(input: {
    userId: string;
    fileId: string;
    chunks: CreateDocumentChunkInput[];
  }): Promise<DocumentChunk[]> {
    await this.deleteByFile(input.userId, input.fileId);

    if (input.chunks.length === 0) {
      return [];
    }

    const statements = input.chunks.map((chunk) => {
      const id = chunk.id ?? crypto.randomUUID();

      return this.db
        .prepare(
          `INSERT INTO document_chunks (
            id,
            file_id,
            user_id,
            chunk_index,
            content,
            vector_id,
            token_estimate,
            embedding_model,
            content_hash,
            metadata_json,
            section_path,
            char_start,
            char_end,
            parent_chunk_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          chunk.fileId,
          chunk.userId,
          chunk.chunkIndex,
          chunk.content,
          chunk.vectorId,
          chunk.tokenEstimate,
          chunk.embeddingModel,
          chunk.contentHash,
          chunk.metadataJson ?? null,
          chunk.sectionPath ?? null,
          chunk.charStart ?? null,
          chunk.charEnd ?? null,
          chunk.parentChunkId ?? null
        );
    });

    await this.db.batch(statements);
    return this.listByFile(input.userId, input.fileId);
  }

  async deleteByFile(userId: string, fileId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM document_chunks WHERE user_id = ? AND file_id = ?")
      .bind(userId, fileId)
      .run();
  }

  async listByFile(userId: string, fileId: string): Promise<DocumentChunk[]> {
    const rows = await this.db
      .prepare("SELECT * FROM document_chunks WHERE user_id = ? AND file_id = ? ORDER BY chunk_index ASC")
      .bind(userId, fileId)
      .all<DocumentChunkRow>();

    return rows.results.map(toDocumentChunk);
  }

  async listByFileLimited(input: {
    userId: string;
    fileId: string;
    limit: number;
  }): Promise<DocumentChunk[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM document_chunks WHERE user_id = ? AND file_id = ? ORDER BY chunk_index ASC LIMIT ?"
      )
      .bind(input.userId, input.fileId, input.limit)
      .all<DocumentChunkRow>();

    return rows.results.map(toDocumentChunk);
  }

  async listByFileAndChunkIndexRange(input: {
    userId: string;
    fileId: string;
    startIndex: number;
    endIndex: number;
  }): Promise<DocumentChunk[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM document_chunks
         WHERE user_id = ?
           AND file_id = ?
           AND chunk_index >= ?
           AND chunk_index <= ?
         ORDER BY chunk_index ASC`
      )
      .bind(input.userId, input.fileId, input.startIndex, input.endIndex)
      .all<DocumentChunkRow>();

    return rows.results.map(toDocumentChunk);
  }

  async listByVectorIds(userId: string, vectorIds: string[]): Promise<DocumentChunk[]> {
    if (vectorIds.length === 0) return [];

    const placeholders = vectorIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(`SELECT * FROM document_chunks WHERE user_id = ? AND vector_id IN (${placeholders})`)
      .bind(userId, ...vectorIds)
      .all<DocumentChunkRow>();

    return rows.results.map(toDocumentChunk);
  }

  async listRecentIndexedByUser(userId: string, limit = 200): Promise<DocumentChunk[]> {
    const rows = await this.db
      .prepare(
        `SELECT document_chunks.*
         FROM document_chunks
         INNER JOIN files ON files.id = document_chunks.file_id
         WHERE document_chunks.user_id = ?
           AND files.user_id = ?
           AND files.status = 'indexed'
         ORDER BY document_chunks.created_at DESC
         LIMIT ?`
      )
      .bind(userId, userId, limit)
      .all<DocumentChunkRow>();

    return rows.results.map(toDocumentChunk);
  }
}

function toDocumentChunk(row: DocumentChunkRow): DocumentChunk {
  return {
    id: row.id,
    fileId: row.file_id,
    userId: row.user_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    vectorId: row.vector_id,
    tokenEstimate: row.token_estimate ?? 0,
    embeddingModel: row.embedding_model ?? "",
    contentHash: row.content_hash ?? "",
    metadataJson: row.metadata_json ?? null,
    sectionPath: row.section_path ?? null,
    charStart: row.char_start ?? null,
    charEnd: row.char_end ?? null,
    parentChunkId: row.parent_chunk_id ?? null,
    createdAt: row.created_at
  };
}
