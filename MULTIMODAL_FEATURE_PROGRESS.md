# Multimodal Feature Progress

## Goal

Multimodal input is designed for the common chat-composer flow:

- User pastes or uploads an image and asks a question or requests OCR.
- User uploads a video and asks for visual understanding based on sampled keyframes.
- User uploads an audio file and asks for transcription.

These media requests should work automatically from `/api/chat`; users should not need to manually choose an intent.

## Current Model Routing

- Default provider: `google-ai-studio`.
- Default model: `gemini-3.1-flash-lite`.
- Intent routing, normal chat, image understanding/OCR, video keyframe understanding, and audio transcription all use Gemini Flash-Lite.
- Deep thinking/deep research uses `GEMINI_CHAT_MODEL=gemini-3-flash-preview`.
- Audio transcription calls Gemini `generateContent` directly with inline audio because the OpenAI-compatible AI Gateway chat format is not used for audio bytes in the current implementation.

## Architecture

Frontend:

- `frontend/src/chat/ChatWorkspace.tsx`
  - Classifies attachments into image, video, audio, and normal file groups.
  - Images and audio are converted to temporary data URLs.
  - Videos are sampled in the browser with `HTMLVideoElement` and `Canvas`.
  - Normal files still go through `/api/files`.
- `frontend/src/chat/useSseChat.ts`
  - Sends `images`, `videos`, and `audios` in `/api/chat`.
  - Keeps request-local media previews in the in-memory chat message.
- `frontend/src/styles/theme.css`
  - Renders image preview cards, native audio controls, and video keyframe carousel styling.

Backend:

- `src/routes/chat.ts`
  - Accepts `images`, `videos`, and `audios`.
  - Supplies default prompts for image-only, video-only, and audio-only requests.
- `src/services/chat-service.ts`
  - Forces media requests into deterministic rule routes:
    - `forcedBy=image_understanding`
    - `forcedBy=video_keyframes`
    - `forcedBy=audio_transcription`
  - Logs dedicated stages:
    - `reply.image_understanding`
    - `reply.video_keyframe_understanding`
    - `reply.audio_transcription`
- `src/services/image-understanding-service.ts`
  - Handles image QA/OCR and video keyframe understanding through AI Gateway + Gemini Flash-Lite.
  - Redacts image/keyframe base64 from LLM logs.
- `src/services/audio-transcription-service.ts`
  - Handles short audio transcription through Gemini `generateContent` inline audio.
  - Redacts audio base64 from LLM logs.

## Implemented

Image understanding/OCR:

- Images can be pasted, dragged, or selected in the chat composer.
- Requests with images bypass normal LLM intent routing and enter the image understanding workflow.
- Supported image MIME types: PNG, JPEG, WebP, GIF.
- Limits: max 4 images per request, max 8 MB per image.
- User message shows submitted image previews.
- Image preview display uses `object-fit: contain` to avoid cropping screenshots or long images.

Video keyframes:

- Video files are sampled in the browser before sending to the backend.
- Sampling strategy:
  - short videos: up to 8 frames
  - medium videos: up to 16 frames
  - long videos: up to 20 frames
- Frames are resized to max edge 1024px and encoded as JPEG.
- The backend prompts Gemini with ordered `image_url` parts and timestamp metadata.
- User message shows extracted keyframes with ChatUI `Carousel`.
- The assistant is instructed to state that answers are based on sampled keyframes, not full-video playback.

Audio transcription:

- Audio files can be uploaded, dragged, or pasted in the chat composer.
- Supported audio types: MP3, WAV, M4A, AAC, FLAC, OGG, Opus, WebM audio.
- Limits: max 2 audio files per request, max 20 MB per file.
- User message shows a native audio player and file metadata.
- The backend sends inline audio bytes to Gemini `generateContent`.

Composer UX:

- Attachment chips now display explicit `x` remove buttons instead of relying on clicking the whole chip.
- Media requests still display a compact text marker in the transcript:
  - `[已附加 n 张图片]`
  - `[已附加 n 个视频，提取 m 个关键帧]`
  - `[已附加 n 段音频]`

Persistence and logging:

- Raw media bytes are not written to D1, R2, or `llm_call_logs`.
- Conversation messages only store media metadata summaries.
- LLM prompt logs use redacted placeholders such as:
  - `[image:redacted; type=...; bytes=...]`
  - `[audio:redacted; type=...; bytes=...]`

## Current Behavior

- Audio transcription has the highest media priority if multiple media types are included.
- Video keyframe understanding takes priority over image understanding.
- Media workflows take priority over smart search and deep thinking toggles.
- Assistant replies are still returned through the existing SSE text stream after the multimodal model call completes.
- Media previews are request-local frontend state and disappear after page refresh.

## Verification

Relevant tests:

```bash
npm run test:ai-gateway-provider
npm run test:image-understanding-service
npm run test:audio-transcription-service
npm run typecheck
npm run build:frontend
```

Recent deployed version after the model routing switch:

```text
0946f2e6-5f84-4414-aaf7-9a53ddb98e4e
```

## Pending

- True streaming output for Gemini multimodal replies.
- Persistent media previews after browser refresh.
- Optional R2 persistence for user-approved media history.
- Full-video Gemini Files API workflow for long videos or audio-aware video summaries.
- Long-audio File API workflow for files larger than inline request limits.
- More robust video scene-change sampling and duplicate-frame removal.
- Browser-based visual QA with representative image, video, and audio fixtures.
