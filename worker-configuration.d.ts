interface Env {
  APP_NAME: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  DEFAULT_CHAT_RUNTIME: string;
  DEFAULT_CHAT_PROVIDER: string;
  DEFAULT_CHAT_MODEL: string;
  DEFAULT_EMBEDDING_MODEL: string;
  VECTOR_DIMENSIONS: string;
  SERPER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  AI: Ai;
  DB: D1Database;
  FILES: R2Bucket;
  CACHE: KVNamespace;
  VECTORIZE: VectorizeIndex;
}
