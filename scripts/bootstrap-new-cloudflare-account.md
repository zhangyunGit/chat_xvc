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
- Vectorize index: `chat-xvc-documents`
- AI Gateway: `deepseek_falsh`
- Workers AI binding in `wrangler.jsonc`

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
export DEEPSEEK_API_KEY="your-deepseek-api-key"
export GEMINI_API_KEY="your-gemini-api-key"
npm run cf:sync-secrets
```

`cf:sync-secrets` also syncs `DEEPSEEK_API_KEY` and `GEMINI_API_KEY`.

Do not commit secrets to the repository.

## 6. Deploy

```bash
npm run cf:deploy
```

The Worker is configured with `workers_dev = true`, so it deploys to the default `*.workers.dev` domain.
