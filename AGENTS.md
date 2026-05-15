# AGENTS.md

## Project Context

This repository implements an intelligent conversational task-management assistant deployed on Cloudflare Workers.

Read `PROJECT_PLAN.md` before making architecture or feature changes. It contains the canonical project requirements, technology decisions, and implementation plan.

## Target Architecture

- Runtime: Cloudflare Workers.
- Language: TypeScript.
- Primary backend framework: Hono or native Workers Fetch API.
- Relational data: Cloudflare D1.
- Object storage: Cloudflare R2.
- Cache/lightweight state: Cloudflare KV.
- Vector database: Cloudflare Vectorize.
- LLM and embeddings: Cloudflare Workers AI by default.
- Public web search: Serper.dev through a swappable `SearchProvider`.

## Engineering Principles

- Keep the application Cloudflare-native unless there is a strong reason not to.
- Use abstraction layers for model, vector store, and search providers.
- Do not hard-code vendor-specific logic into business workflows.
- Prefer small, focused modules over large monolithic files.
- Implement root-cause fixes, not surface patches.
- Keep all state-changing operations persisted through D1, R2, KV, or Vectorize.
- Every verified Cloudflare creation/configuration operation must be recorded in a script, config file, migration, or documentation so a new Cloudflare account can rebuild the project.

## Agent Design

- Use an Intent Router before selecting tools or prompt templates.
- Use dynamic prompt templates instead of one large universal prompt.
- Separate workflows for profile collection, task management, document RAG, web research, memory recall, and clarification.
- All tool calls that mutate data must be auditable and persisted.

## Frontend Design Skill

- For any UI, styling, component, page, chat interface, upload workspace, or React/Vite frontend task, read and follow `skills/frontend-design/SKILL.md`.
- Use the skill to choose a deliberate aesthetic direction before coding.
- Keep frontend implementation compatible with Cloudflare Workers deployment.

## Secrets

- Never commit API keys or secrets.
- Use `.dev.vars` only for local development and keep it ignored.
- Use `wrangler secret put` or Cloudflare Dashboard Secrets for production.
- Do not request or store Cloudflare passwords or Global API Keys.
- Keep `config.json`, `cloudflare.resources.json`, and `wrangler.generated.jsonc` out of Git because they are local/account-specific.
- Do not store `CLOUDFLARE_API_TOKEN` in repository files; pass it through the shell environment when running provisioning/deploy commands.

## Cloudflare Reproducibility

- Keep `scripts/bootstrap-new-cloudflare-account.md` updated whenever provisioning steps change.
- Keep `scripts/provision-cloudflare.mjs` as the canonical automated resource creation entrypoint.
- Put D1 schema changes in `migrations/`.
- Keep `wrangler.jsonc` readable and aligned with the created bindings.
- Prefer default `workers.dev` deployment unless the user explicitly requests a custom domain.

## Documentation

- Keep `README.md` focused on setup, deployment, and usage.
- Keep `PROJECT_PLAN.md` as the high-level product and architecture plan.
- Update docs when architecture decisions change.
