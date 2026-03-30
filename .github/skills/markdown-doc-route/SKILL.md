---
name: markdown-doc-route
description: 'Add markdown document web routes (for example /toc.md) in this Fastify service. Use when creating or updating route handlers that read .md files, convert markdown to HTML, register GET routes in index.js, and validate behavior with tests.'
argument-hint: 'Which URL path(s) and markdown file(s) should be exposed?'
user-invocable: true
---

# Markdown Document Route

## Current Implementation Status

Three markdown document routes are currently registered and ready for use:

- **GET `/terms`** — Terms of Service
    - File: `TERMS_AND_CONDITIONS_FILE_PATH` env var (default: `tos.md`)
- **GET `/privacy-policy`** — Privacy Policy
    - File: `PRIVACY_POLICY_FILE_PATH` env var (default: `privacy-policy.md`)
- **GET `/how-to-opt-in`** — SMS Enrollment Instructions
    - File: `HOW_TO_OPT_IN_FILE_PATH` env var (default: `how-to-opt-in.md`)

All routes render markdown to HTML with a standard page template using the `createMarkdownDocHandler` factory in [src/routes/markdown-doc.js](../../src/routes/markdown-doc.js).

## When to Use

- Add a new text document URL path such as `/toc.md`.
- Expose one or more markdown files through the Fastify service.
- Standardize markdown rendering logic in one reusable route handler.

## Outcome

- A generic route handler file that reads a markdown file, converts it to HTML, and responds from a URL path.
- `index.js` registers the new path(s) with `fastify.get(...)`.
- Route-to-file mappings can be driven by explicit env vars (example: `TERMS_AND_CONDITIONS_FILE_PATH`).
- Tests verify path mapping, markdown rendering, and error behavior.

## Procedure

1. Confirm requirements and mapping.

- Capture each route mapping as `urlPath -> markdownFilePath` (example: `/toc.md -> docs/toc.md`) or `urlPath -> envVarName` (example: `/terms-and-conditions -> TERMS_AND_CONDITIONS_FILE_PATH`).
- Decision point: if multiple paths are requested, implement one shared generic handler and register each mapping in `index.js`.

2. Add or update the generic markdown route handler.

- Create a route module under `src/routes/` (for example `src/routes/markdown-doc.js`).
- Implement a handler factory that accepts file path input and returns a Fastify handler.
- Read markdown content from disk with safe path handling. If env-var mapping is used, resolve and validate the env var value first.
- Convert markdown to HTML with the project's existing dependency if available; if none exists, add a minimal, maintained markdown renderer and document the dependency change.
- Return `text/html; charset=utf-8` and a complete, safe HTML document shell.

3. Register `GET` route(s) in `index.js`.

- Import the route handler/factory.
- Register each path with `fastify.get(urlPath, handler)`.
- Keep style consistent with existing route registration patterns in `index.js`.

4. Add tests.

- Add route tests under `src/routes/` and integration tests when route behavior crosses module boundaries.
- Cover: successful render, missing file (default: 500), missing/invalid env var value, and invalid mapping input.

5. Validate and format.

- Run `npm test`.
- If formatting/linting fails, run `npm run lint:fix` or targeted fixes, then re-run `npm test`.

## Decision Rules

- If only one static route is needed now, still use the generic handler so future docs do not duplicate logic.
- Prefer env-var file mapping when the user requests configurable file locations (example: `TERMS_AND_CONDITIONS_FILE_PATH`).
- If markdown files are user-controlled or external, enforce stricter sanitization; if repo-controlled docs only, keep sanitizer posture documented in code comments.
- If route paths conflict with existing endpoints, preserve existing behavior and select a non-conflicting path.

## Completion Checklist

- Generic markdown-to-HTML handler exists in `src/routes/`.
- New path(s) are registered as `GET` in `index.js`.
- Response content type is `text/html`.
- Tests cover success and failure paths, including missing env-var or file behavior returning `500`.
- `npm test` passes.

## Example Prompts

- `/markdown-doc-route Add /toc.md that serves docs/toc.md as HTML.`
- `/markdown-doc-route Add /privacy.md and /terms.md using one shared markdown handler.`
- `/markdown-doc-route Refactor existing markdown route logic into a generic handler and wire routes in index.js.`
- `/markdown-doc-route Add a new /faq route for FAQ documentation.`
