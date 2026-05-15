# Chat XVC

Cloudflare-native intelligent conversational task-management assistant.

## Public URL

- Worker: `https://chat-xvc.yun007x.workers.dev`

## Stack

- Cloudflare Workers
- React + Vite + TypeScript for the formal frontend
- Cloudflare D1
- Cloudflare R2
- Cloudflare KV
- Cloudflare Vectorize
- Cloudflare Workers AI
- Cloudflare AI Gateway for chat LLM routing
- DeepSeek as the default chat model provider
- Gemini configured as an alternate chat model provider
- Serper.dev for public web search

## Local Setup

```bash
npm install
cp config.example.json config.json
export CLOUDFLARE_API_TOKEN="your-scoped-api-token"
export DEEPSEEK_API_KEY="your-deepseek-api-key"
export GEMINI_API_KEY="your-gemini-api-key"
```

Fill `config.json` with your Cloudflare account information.

## Provision Cloudflare

```bash
npm run cf:provision
npm run cf:sync-secrets
npm run cf:migrate:remote
```

See `scripts/bootstrap-new-cloudflare-account.md` for the full reproducible setup flow.
Provisioning creates an account-specific `wrangler.generated.jsonc` from the committed `wrangler.jsonc` template.

The default chat model is routed through Cloudflare AI Gateway:

- Gateway ID: `deepseek_falsh`
- Default provider/model: `deepseek/deepseek-v4-flash`
- Alternate provider/model: `google-ai-studio/gemini-3-flash-preview`

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run cf:deploy
```

## Documentation

- `readme.txt`: original assignment.
- `PROJECT_PLAN.md`: requirements, architecture, and implementation plan.
- `ARCHITECTURE.md`: code layering, module responsibilities, and call-flow design.
- `INTENT.md`: fine-grained intent registry and Intent Router implementation plan.
- `AGENTS.md`: coding-agent rules for this repository.
- `skills/frontend-design/SKILL.md`: frontend design direction and UI quality rules.
