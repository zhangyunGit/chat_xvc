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
- Default provider/model: `google-ai-studio/gemini-3.1-flash-lite`
- Deep thinking model: `google-ai-studio/gemini-3-flash-preview`
- Legacy alternate provider/model: `deepseek/deepseek-v4-flash`
- Image understanding/OCR model: `google-ai-studio/gemini-3.1-flash-lite`
- Video keyframe understanding model: `google-ai-studio/gemini-3.1-flash-lite`
- Audio transcription model: `gemini-3.1-flash-lite`

## LLM Call Logging

The Worker writes request-level AI trace records to D1 table `llm_call_logs` when `LLM_LOGGING_ENABLED` is enabled.

Current behavior:

- Each `/api/chat` request gets a `requestId`, returned in the SSE `meta` event.
- All AI-related stages in that request share the same `request_id`.
- Rule and forced intent routing also write a trace row, with `provider=rule` and `model_name=rule`, so a request with rule routing still has an intent-stage log.
- LLM intent routing, profile extraction, reply generation, deep research planning/step analysis/synthesis, and conversation stage summaries write separate rows with `stage`, `intent`, `provider`, `model_name`, `status`, and optional `duration_ms` / `error_text`.
- If intent routing or reply generation throws before a normal response is available, the Worker writes `intent.error` or `reply.error` with `status=error` and `error_text`.

Useful stages include:

```text
intent.rule
intent.llm
intent.forced_web_search
intent.forced_deep_research
profile.intake
profile.update
reply.general
reply.web_answer
reply.memory_recall
reply.document_summary
reply.document_qa
reply.task_tool_result
research.plan
research.step_analysis.{n}
research.synthesis
memory.stage_summary
intent.error
reply.error
```

Logging switch:

```jsonc
"LLM_LOGGING_ENABLED": "true"
```

Set it to `false`, `0`, `off`, `no`, or `disabled` to skip writing `llm_call_logs`.

Example D1 lookup:

```sql
SELECT called_at, request_id, stage, intent, provider, model_name, status
FROM llm_call_logs
WHERE request_id = '...'
ORDER BY called_at, created_at;
```

## Development

```bash
npm run dev
```

For frontend-only Vite development:

```bash
npm run dev:frontend
```

For a production frontend build served by the Worker assets binding:

```bash
npm run build:frontend
```

## File Upload

The frontend attachment button, paste, and drag-and-drop flows upload files to:

```text
POST /api/files
```

Upload behavior:

- Request type: `multipart/form-data`
- Fields: `userId` optional, `files` repeated
- Limit: up to 12 files per request, 25 MB per file
- Raw files are stored in Cloudflare R2 under `users/{userId}/files/...`
- File metadata is persisted in D1 table `files`
- Files are indexed asynchronously with Workers AI `@cf/baai/bge-m3` and Vectorize. Supported indexing formats currently include TXT, Markdown, JSON, CSV, PDF, and DOCX.
- Legacy binary `.doc` files are not indexed; upload `.docx` instead.
- Indexed files can be searched, summarized, and used for document Q&A through chat intents such as `document.search`, `document.summarize`, and `document.qa`.
- In the common flow where a user drags a file into the chat box and says "请总结该文档内容", the frontend uploads the file first, attaches the returned file id to the chat message, and the backend routes the request to `document.summarize`.
- Summary requests wait briefly for asynchronous indexing to finish. If the file is still processing, the assistant asks the user to retry after a few seconds.

List uploaded files:

```text
GET /api/files?userId={userId}
```

Delete an uploaded file and its indexed data:

```text
DELETE /api/files/{fileId}?userId={userId}
```

Deletion removes the R2 object, deletes `document_chunks`, deletes the corresponding Vectorize vectors, and marks the D1 `files` row as `deleted`.

Current file/RAG capability status:

- Complete: upload, R2 raw-file storage, D1 metadata, asynchronous parsing, chunking, BGE-M3 embedding, Vectorize storage, file listing, explicit UI deletion, document search, document Q&A, adjacent chunk expansion, and upload-to-summary linkage.
- Supported indexing formats: TXT, Markdown, JSON, CSV, PDF, DOCX.
- Not supported: legacy binary `.doc`; upload `.docx` instead.
- Current summary limit: single-file direct summary over the first 24 chunks. Long-document hierarchical summary is still pending.
- Pending RAG improvements: parent section expansion and reranker-based second-stage ranking.

## External Search

Research intents use the `SearchProvider` abstraction with Serper.dev as the default provider.

Configuration:

```bash
export SERPER_API_KEY="your-serper-api-key"
npm run cf:sync-secrets
```

Current behavior:

- Research intents such as `research.quick_search`, `research.latest_info`, `research.fact_check`, `research.compare_options`, and `research.deep_report` trigger external web search.
- Selecting "智能搜索" in the chat composer sends `forceWebSearch: true`, so the message defaults to the external search workflow even if the text itself is ambiguous.
- Selecting "深度思考" in the chat composer sends `forceDeepResearch: true`, so the message defaults to the deep research workflow even if the text itself is ambiguous.
- Search results are cached in Cloudflare KV for 15 minutes.
- Search results are passed into the research prompt and returned to the frontend as `ui.webResults`.
- The frontend renders web sources as clickable external result cards. By default it shows 3 links and provides a lightweight button to reveal the remaining references.
- If the search provider fails or the secret is missing, the assistant gives a clear user-facing failure message instead of silently answering without search results.

Current limitations:

- Deep research is currently enabled for `research.deep_report`; compare and fact-check intents still use the simpler single-search flow.

## Long-Term Memory

The `memory` branch adds the first version of user-controlled long-term memory.

Current behavior:

- Explicit memory writes are supported through messages such as "请记住：我喜欢简洁的回答" or "我的偏好是先给结论再解释".
- Memories are persisted in D1 table `memories`.
- Memory embeddings use Workers AI `@cf/baai/bge-m3` and the existing Vectorize index.
- Memory vectors use metadata `type=memory`, so they can be retrieved separately from document chunks.
- Memory vector ids use `memory:{memoryId}` to stay under Vectorize id length limits; user scoping is enforced through vector metadata and D1 rows.
- General chat and small talk also persist a lightweight conversation snippet memory with vector id `cmem:{memoryId}` and metadata `type=conversation_memory`.
- Conversation snippets are embedded from the compacted original user/assistant turn.
- Every conversation creates a stage summary after completed assistant turns 10, 18, 26, and so on. Each summary covers the latest 10 turns, so adjacent summaries overlap by 2 turns.
- Stage summaries use vector id `csum:{memoryId}` and metadata `type=conversation_summary`; their embeddings are generated from the LLM summary text, not the raw 10-turn transcript.
- General chat and small talk recall explicit memories, relevant conversation snippets, and stage summaries, then inject them into the prompt as a memory/context block.
- Follow-up questions such as "刚才提到的项目叫什么" fall back to recent conversation snippets when vector recall returns no match.
- Explicit recall questions use the recalled memory/context block to generate a natural answer instead of only dumping the raw memory list.
- Users can ask what is remembered, recall related memories, or delete memories by topic.
- The chat header includes a "记忆" management panel for listing, refreshing, and deleting individual memories.

Memory management API:

```text
GET /api/memories?userId={userId}
DELETE /api/memories/{memoryId}?userId={userId}
```

First-stage limits:

- Explicit preference/fact/instruction memory writing is still user-controlled; automatic storage is limited to compact conversation snippets for general chat and small talk.
- Delete-by-topic is implemented, but low-confidence deletion confirmation is still pending.
- Stage summary generation currently runs synchronously on the trigger turn; moving it to `ctx.waitUntil` is still pending.
- Conversation snippets and stage summaries do not yet deduplicate semantically similar memories.
- The memory panel is intentionally lightweight; category filters, search, and bulk operations are pending.

## Deep Research

The `research` branch adds a first version of the deep research workflow for `research.deep_report`.

Model routing:

- Planner: configured as `gemini-3-flash-preview` through Google AI Studio
- Per-subtask analysis: configured as `gemini-3-flash-preview` through Google AI Studio
- Final synthesis: configured as `gemini-3-flash-preview` through Google AI Studio
- Gemini pro is configured for later use as `google-ai-studio/gemini-3.1-pro-preview`

Workflow:

- Plan the research objective and 3-5 search subtasks.
- Run external search for each subtask.
- Analyze each subtask with the default fast model.
- Deduplicate sources and synthesize a structured report with the pro model.
- Stream progress updates to the frontend as `ui.researchSteps`.
- Stream user-visible planner and synthesis thinking into ChatUI `Think` components with `thinkStart`, `thinkDelta`, and `thinkDone` UI events.
- The streamed Think content is field-filtered from the model JSON `thinking` value; planning steps and final report content are parsed server-side but not streamed into the Think panel.
- Research messages render in workflow order: planner thinking, plan summary, subtask progress, synthesis thinking, final report, and web references. The chat log auto-scrolls as these sections update, and each subtask can be clicked to expand its full content.
- Long Think content is rendered with ChatUI `Bubble` inside `Think`, with a bounded scroll area and the native Think collapse toggle.

## Deploy

```bash
npm run cf:deploy
```

`cf:deploy` builds the React/Vite frontend into `dist/client` before deploying the Worker.

## Documentation

- `readme.txt`: original assignment.
- `LOGGING_FEATURE_PROGRESS.md`: current LLM request trace logging design and verification notes.
- `MEMORY_FEATURE_PROGRESS.md`: current memory-system progress and next steps.
- `MULTIMODAL_FEATURE_PROGRESS.md`: current image/OCR, video keyframe, and audio transcription design and verification notes.
- `PROJECT_PLAN.md`: requirements, architecture, and implementation plan.
- `ARCHITECTURE.md`: code layering, module responsibilities, and call-flow design.
- `INTENT.md`: fine-grained intent registry and Intent Router implementation plan.
- `AGENTS.md`: coding-agent rules for this repository.
- `skills/frontend-design/SKILL.md`: frontend design direction and UI quality rules.
