ALTER TABLE files ADD COLUMN processing_error TEXT;
ALTER TABLE files ADD COLUMN indexed_at TEXT;

ALTER TABLE document_chunks ADD COLUMN embedding_model TEXT DEFAULT '';
ALTER TABLE document_chunks ADD COLUMN content_hash TEXT DEFAULT '';
ALTER TABLE document_chunks ADD COLUMN metadata_json TEXT;
ALTER TABLE document_chunks ADD COLUMN section_path TEXT;
ALTER TABLE document_chunks ADD COLUMN char_start INTEGER;
ALTER TABLE document_chunks ADD COLUMN char_end INTEGER;
ALTER TABLE document_chunks ADD COLUMN parent_chunk_id TEXT;

CREATE INDEX IF NOT EXISTS idx_document_chunks_vector_id ON document_chunks(vector_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_file ON document_chunks(user_id, file_id);
