CREATE TABLE IF NOT EXISTS llm_call_logs (
  id TEXT PRIMARY KEY,
  called_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT NOT NULL,
  user_name TEXT,
  user_email TEXT,
  model_name TEXT NOT NULL,
  query_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  prompt_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_llm_call_logs_user_id ON llm_call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_called_at ON llm_call_logs(called_at);

