# Rebuild on a New Cloudflare Account

This document records the reproducible setup flow for creating all Cloudflare resources needed by this project.

## 1. Prerequisites

- Node.js 20+
- npm
- A Cloudflare account
- A scoped Cloudflare API token for non-interactive Wrangler commands

```bash
npm install
```

For this Codex/CLI environment, prefer an API token instead of browser login:

```bash
export CLOUDFLARE_API_TOKEN="your-scoped-api-token"
```

Recommended token permissions:

- Account: Workers Scripts Edit
- Account: D1 Edit
- Account: Workers KV Storage Edit
- Account: Vectorize Edit
- Account: Workers AI Read
- Account: AI Gateway Read
- Account: AI Gateway Edit
- Account: Account Settings Read
- Zone: Workers Routes Edit, only if using a custom domain later
- R2: Edit, if your Cloudflare token UI separates R2 permissions

## 2. Configure Account

Copy the local config template:

```bash
cp config.example.json config.json
```

Fill `config.json`:

```json
{
  "cloudflare": {
    "account_name": "your-cloudflare-account-name",
    "account_id": "your-cloudflare-account-id",
    "domain_name": "workers.dev"
  },
  "serper": {
    "apikey": "your-serper-api-key"
  },
  "deepseek": {
    "apikey": "optional-local-deepseek-api-key-or-use-DEEPSEEK_API_KEY-env"
  },
  "gemini": {
    "apikey": "optional-local-gemini-api-key-or-use-GEMINI_API_KEY-env"
  }
}
```

`config.json` is intentionally ignored by Git because it is account-specific.

## 3. Create Cloudflare Resources

Run:

```bash
npm run cf:provision
```

The provisioning script creates:

- D1 database: `chat_xvc_db`
- R2 bucket: `chat-xvc-files`
- KV namespace: `chat_xvc_cache`
- Vectorize index: `chat-xvc-documents-m3`
- AI Gateway: `deepseek_falsh`
- Workers AI binding in `wrangler.jsonc`
- Static frontend assets binding: `ASSETS`, served from `dist/client`

It then writes:

- `cloudflare.resources.json`: account-specific resource IDs
- `wrangler.generated.jsonc`: account-specific Wrangler bindings

`config.json`, `cloudflare.resources.json`, and `wrangler.generated.jsonc` are account-specific and ignored by Git.

If R2 has not been enabled for the Cloudflare account yet, provisioning records the bucket as `pending_dashboard_enablement`.
Open the Cloudflare Dashboard, enable R2 for the account, then rerun:

```bash
npm run cf:provision
```

## 4. Apply D1 Migrations

```bash
npm run cf:migrate:remote
```

## 5. Configure Secrets

Serper.dev is external and should be stored as a Worker secret:

```bash
export SERPER_API_KEY="your-serper-api-key"
export DEEPSEEK_API_KEY="your-deepseek-api-key"
export GEMINI_API_KEY="your-gemini-api-key"
npm run cf:sync-secrets
```

`cf:sync-secrets` also syncs `DEEPSEEK_API_KEY` and `GEMINI_API_KEY`.

The default flash and pro model vars are configured in `wrangler.jsonc`:

```text
DEFAULT_CHAT_PROVIDER=google-ai-studio
DEFAULT_CHAT_MODEL=gemini-3.1-flash-lite
DEEPSEEK_PRO_MODEL=deepseek-v4-pro[1m]
GEMINI_CHAT_MODEL=gemini-3-flash-preview
GEMINI_LITE_MODEL=gemini-3.1-flash-lite
GEMINI_PRO_MODEL=gemini-3.1-pro-preview
LLM_LOGGING_ENABLED=true
```

Do not commit secrets to the repository.

`LLM_LOGGING_ENABLED` controls D1 writes to `llm_call_logs`. Set it to `false`, `0`, `off`, `no`, or `disabled` to disable request-level LLM trace logging.

## 6. Deploy

```bash
npm run cf:deploy
```

`cf:deploy` first runs `npm run build:frontend`, then deploys the Worker with the React/Vite static assets.

The Worker is configured with `workers_dev = true`, so it deploys to the default `*.workers.dev` domain.

## 7. File Upload Verification

The file upload feature depends on:

- R2 bucket binding: `FILES`
- D1 table: `files`
- D1 table: `document_chunks`
- Vectorize index: `chat-xvc-documents-m3`

After deployment, upload requests use:

```text
POST /api/files
```

Files are stored in R2 and metadata is persisted in D1. The later RAG phase will parse uploaded files, create chunks, generate embeddings, and write vectors to Vectorize.

## 8. Memory Verification

The long-term memory feature depends on:

- D1 table: `memories`
- Vectorize index: `chat-xvc-documents-m3`
- Workers AI embedding model: `@cf/baai/bge-m3`

After applying migrations and deploying, verify memory through chat:

```text
请记住：我喜欢简洁的回答
你现在都记住了什么？
忘记关于简洁回答的偏好
```

General chat and small talk also persist compact conversation snippets as `kind=conversation` rows in `memories` and `type=conversation_memory` vectors in `chat-xvc-documents-m3`.

Each conversation additionally writes a stage summary after completed assistant turns 10, 18, 26, and so on. Each summary covers the latest 10 turns, so adjacent summaries overlap by 2 turns. These rows use `kind=conversation_summary`, vector id `csum:{memoryId}`, and Vectorize metadata `type=conversation_summary`. The embedding is generated from the summary text, not from the raw 10-turn transcript.

Explicit long-term memories, compact snippets, and stage summaries are recalled together. Raw rows from `messages` are not directly searched.

Memory management API:

```text
GET /api/memories?userId={userId}
DELETE /api/memories/{memoryId}?userId={userId}
```
