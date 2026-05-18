import type { CreateUploadedFileInput, UploadedFile, UploadedFileStatus } from "../types/domain";

type UploadedFileRow = {
  id: string;
  user_id: string;
  r2_key: string;
  filename: string;
  content_type: string | null;
  size: number | null;
  status: UploadedFileStatus;
  processing_error?: string | null;
  indexed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export class FileRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateUploadedFileInput): Promise<UploadedFile> {
    const id = input.id ?? crypto.randomUUID();

    await this.db
      .prepare(
        "INSERT INTO files (id, user_id, r2_key, filename, content_type, size, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        input.userId,
        input.r2Key,
        input.filename,
        input.contentType ?? null,
        input.size,
        input.status ?? "uploaded"
      )
      .run();

    const file = await this.findById(input.userId, id);
    if (!file) {
      throw new Error("Failed to create file record");
    }

    return file;
  }

  async findById(userId: string, fileId: string): Promise<UploadedFile | null> {
    const row = await this.db
      .prepare("SELECT * FROM files WHERE user_id = ? AND id = ?")
      .bind(userId, fileId)
      .first<UploadedFileRow>();

    return row ? toUploadedFile(row) : null;
  }

  async findByIdForUserlessLookup(fileId: string): Promise<UploadedFile | null> {
    const row = await this.db
      .prepare("SELECT * FROM files WHERE id = ?")
      .bind(fileId)
      .first<UploadedFileRow>();

    return row ? toUploadedFile(row) : null;
  }

  async listByUser(userId: string): Promise<UploadedFile[]> {
    const rows = await this.db
      .prepare("SELECT * FROM files WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC")
      .bind(userId)
      .all<UploadedFileRow>();

    return rows.results.map(toUploadedFile);
  }

  async listByIds(userId: string, fileIds: string[]): Promise<UploadedFile[]> {
    if (fileIds.length === 0) return [];

    const placeholders = fileIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(`SELECT * FROM files WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(userId, ...fileIds)
      .all<UploadedFileRow>();

    return rows.results.map(toUploadedFile);
  }

  async updateStatus(input: {
    userId: string;
    fileId: string;
    status: UploadedFileStatus;
    processingError?: string | null;
    indexedAt?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        "UPDATE files SET status = ?, processing_error = ?, indexed_at = COALESCE(?, indexed_at), updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ? AND (status != 'deleted' OR ? = 'deleted')"
      )
      .bind(
        input.status,
        input.processingError ?? null,
        input.indexedAt ?? null,
        input.userId,
        input.fileId,
        input.status
      )
      .run();
  }
}

function toUploadedFile(row: UploadedFileRow): UploadedFile {
  return {
    id: row.id,
    userId: row.user_id,
    r2Key: row.r2_key,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size ?? 0,
    status: row.status,
    processingError: row.processing_error ?? null,
    indexedAt: row.indexed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
