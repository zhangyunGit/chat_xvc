ALTER TABLE llm_call_logs ADD COLUMN request_id TEXT;
ALTER TABLE llm_call_logs ADD COLUMN conversation_id TEXT;
ALTER TABLE llm_call_logs ADD COLUMN stage TEXT;
ALTER TABLE llm_call_logs ADD COLUMN intent TEXT;
ALTER TABLE llm_call_logs ADD COLUMN provider TEXT;
ALTER TABLE llm_call_logs ADD COLUMN status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE llm_call_logs ADD COLUMN duration_ms INTEGER;
ALTER TABLE llm_call_logs ADD COLUMN error_text TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_call_logs_request_id ON llm_call_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_conversation_id ON llm_call_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_stage ON llm_call_logs(stage);
