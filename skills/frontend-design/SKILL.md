---
name: frontend-design
description: Use this skill when building or refining this project's web UI, including pages, components, dashboards, chat interfaces, upload/workspace screens, HTML/CSS layouts, and React/Vite frontend work. Produce distinctive, production-grade interfaces with strong visual direction rather than generic AI-looking designs.
license: Apache-2.0; adapted from Anthropic frontend-design skill. See LICENSE.txt.
---

# Frontend Design

Create distinctive, production-grade frontend interfaces for Chat XVC. Avoid generic AI aesthetics and implement real working UI code with careful attention to typography, layout, color, motion, accessibility, and Cloudflare-friendly performance.

## Before Coding

Commit to a clear design direction before writing UI code:

- **Purpose**: What user problem does this screen solve?
- **Audience**: Is this for an individual task user, a knowledge worker, or an evaluator reviewing the project?
- **Tone**: Choose an intentional aesthetic such as refined minimal, editorial, retro-futuristic, industrial, playful, soft/pastel, geometric, brutalist, or luxury.
- **Differentiation**: Identify one memorable visual idea for the interface.
- **Constraints**: Preserve accessibility, responsive behavior, fast loading, and compatibility with Cloudflare Workers.

Do not default to a bland SaaS dashboard unless the user explicitly asks for one. A calm minimal interface is fine, but it must still feel deliberately designed.

## Project UI Direction

For this project, prefer a polished "edge-native AI workspace" direction:

- Calm, focused chat-first workspace.
- High trust and clarity for task management, files, RAG citations, and research reports.
- Subtle technical atmosphere: glass, grid, signal, document, memory, and edge-network motifs.
- Strong information hierarchy, especially for long agent outputs and structured reports.
- Fast, lightweight interactions that work well as static assets served by Workers.

## Design Quality Checklist

- **Typography**: Use a deliberate type system. Avoid thoughtless default stacks. If external fonts are not appropriate, tune system fonts with spacing, weights, sizing, and contrast.
- **Color**: Use CSS variables. Pick a cohesive palette with a dominant surface model and one or two sharp accents.
- **Composition**: Use generous spacing, clear rhythm, and occasional asymmetry or layered panels where it helps.
- **Motion**: Use purposeful CSS motion for message streaming, loading, hover states, uploads, and state transitions. Respect `prefers-reduced-motion`.
- **Background Detail**: Add subtle atmosphere through gradients, meshes, grids, glows, borders, grain, or depth when it supports the concept.
- **States**: Design loading, empty, error, disabled, drag-over, streaming, success, and destructive states.
- **Accessibility**: Maintain semantic HTML, focus states, keyboard use, contrast, and readable font sizes.
- **Responsiveness**: Make mobile, tablet, and desktop layouts feel intentional, not merely squeezed.

## Avoid

- Generic purple-gradient-on-white AI SaaS styling.
- Predictable card grids without visual hierarchy.
- Overusing default fonts, default shadows, default rounded rectangles, and default blue buttons.
- Adding decoration that harms readability.
- Large frontend dependencies unless they clearly pay for themselves.
- UI work that is only a mockup when the user asked for working code.

## Implementation Guidance

- Prefer React + Vite + TypeScript when the formal frontend is introduced.
- Until then, keep the Worker-served HTML/CSS in `src/ui.ts` simple, functional, and easy to replace.
- Keep design tokens centralized when the frontend grows.
- Use CSS variables for colors, radii, spacing, shadows, and motion timings.
- Do not break Cloudflare Worker deployment while improving UI.
- Validate with `npm run typecheck` after TypeScript changes.

## Output Expectations

When delivering frontend work:

- State the chosen aesthetic direction briefly.
- Implement the actual code, not just a design description.
- Mention the main files changed.
- Call out any follow-up steps, such as replacing the temporary Worker inline UI with React/Vite.

