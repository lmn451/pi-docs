# AGENTS.md — pi-doc-injector

This is a Pi extension. Read `package.json`, `README.md`, and the relevant source and tests before making changes.

## Purpose

The extension scans project docs and adds selected files to the model context as a `CustomMessage` from `before_agent_start` or a persisted `custom_message` draft from `turn_end`. It never edits the system prompt. A document is marked injected once per extension session; `/doc-inject reset` clears those marks. Reload rebuilds in-memory marks, while injection history is read independently from native current-branch session entries.

## Matching modes

- **Simple (default):** `docs/{name}.md` matches the complete, case-insensitive word `{name}` in full user input or each completed assistant text/thinking block independently. Only top-level `.md` files are indexed. No streaming scans, windowing, frontmatter, cache, or keyword generation is required.
- **Keywords (opt-in):** Frontmatter, cached, heuristic, or LLM-generated keywords can match docs. The configured `matchThreshold` counts distinct keywords. A tail window limits streaming scan cost; keyword hits accumulate across updates of one assistant message.

`input` handles full user text before `before_agent_start` injects. Simple mode scans the finalized assistant message at Pi 1.5.2's actionable `turn_end` boundary, after assistant and tool persistence. It returns existing `event.entries` plus a `custom_message` draft and `continue: true` only for new documents on a completed outcome. This ensures one next provider request; natural tool/steering continuation satisfies it. It cannot alter the finished request. Allow at most one boundary injection batch per user run, resetting at user `before_agent_start`, not low-level `agent_start`. Defer further matches to the next run and notify once. Never inject/continue on aborted or error outcomes, abort an active run, or send a synthetic user `continue`.

Only keyword mode scans `message_update`. `extractText()` reads `text` blocks and `thinking` blocks (whose content field is `thinking` in Pi 1.5.2). Keyword assistant matches remain queued for the **next** agent run.

`message_end` clears streaming hits, even for non-assistant messages. `session_start` resets pending matches and initializes the registry. Pi creates a new extension runtime on reload and session replacement; a reload `session_start` must initialize the new registry before `resources_discover` rebuilds it.

## Module map

| File                               | Role                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `index.ts`                         | Pi event handlers, matching state, injection, keyword tool |
| `registry.ts`                      | Doc scan and entry lifecycle; rejects symlinked files      |
| `matcher.ts`                       | Whole-word matching and text/thinking extraction           |
| `config.ts`                        | Validates `.pi/doc-injector.json`                          |
| `cache.ts`                         | Validates and persists keyword-mode cache                  |
| `keyword-gen.ts`, `keyword-llm.ts` | Optional keyword generation                                |
| `injector.ts`                      | CustomMessage content and keyword display sanitization     |
| `audit.ts`                         | Versioned injection reasons and history parsing            |
| `commands.ts`                      | `/doc-*` commands, including injection history             |
| `types.ts`                         | Shared types and defaults                                  |

## Invariants

1. Keep the system prompt unchanged. Inject only through a `CustomMessage` from `before_agent_start` or a `custom_message` entry draft returned by `turn_end`. Preserve other extensions' boundary entries/continuation decisions.
2. Exclude injected docs from the matcher and call `markInjected()` after preparation succeeds, immediately before returning the message/draft. Pi has no post-commit extension callback; marks reflect proposed injection. Keep pending matches keyed by `filePath`.
3. The keyword matcher must test within its tail window without inventing a word boundary at its left edge. Count distinct keywords only.
4. Reject symlinked docs and keyword-tool paths that do not name registered docs. Validate loaded cache and config data before use.
5. Keep keyword display sanitization in `injector.ts`.
6. Store injection reasons as versioned `details` on actual doc-inject custom messages/drafts. History reads saved entries from the current native branch; do not create a separate audit log or duplicate document bodies, and do not treat a saved message as proof the model read the document. Legacy messages without usable reasons metadata are unavailable, not grounds to infer reasons.

## Checks

```bash
npm test
npm run typecheck
npm run format:check
```

The package has no build script. Pi loads `index.ts` directly. Tests are Vitest. Add integration tests for event-flow changes. Do not run `npm run format` without checking which untracked files it could touch; format changed files only.
