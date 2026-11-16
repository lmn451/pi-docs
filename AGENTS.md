# AGENTS.md — pi-doc-injector

This is a Pi extension. Read `package.json`, `README.md`, and the relevant source and tests before making changes.

## Purpose

The extension scans project docs and adds selected files to the model context as a `CustomMessage` from `before_agent_start`. It never edits the system prompt. A document is marked injected once per session; `/doc-inject reset` clears those marks.

## Matching modes

- **Simple (default):** `docs/{name}.md` matches the complete, case-insensitive word `{name}` in user input, assistant text, or assistant thinking. Only top-level `.md` files are indexed. No frontmatter, cache, or keyword generation is required.
- **Keywords (opt-in):** Frontmatter, cached, heuristic, or LLM-generated keywords can match docs. The configured `matchThreshold` counts distinct keywords. A tail window limits streaming scan cost; keyword hits accumulate across updates of one assistant message.

`input` handles user text before the assistant starts. `message_update` receives the accumulated assistant message; `extractText()` reads `text` blocks and `thinking` blocks (whose content field is `thinking` in Pi 1.5.2). A match during assistant output is queued for the **next** agent run. Never abort the active run or send a synthetic `continue` message for an assistant match.

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
| `commands.ts`                      | `/doc-*` commands                                          |
| `types.ts`                         | Shared types and defaults                                  |

## Invariants

1. Keep the system prompt unchanged. Inject only through a `CustomMessage` returned by `before_agent_start`.
2. Exclude injected docs from the matcher and call `markInjected()` before returning the message. Keep pending matches keyed by `filePath`.
3. The keyword matcher must test within its tail window without inventing a word boundary at its left edge. Count distinct keywords only.
4. Reject symlinked docs and keyword-tool paths that do not name registered docs. Validate loaded cache and config data before use.
5. Keep keyword display sanitization in `injector.ts`.

## Checks

```bash
npm test
npm run typecheck
npm run format:check
```

The package has no build script. Pi loads `index.ts` directly. Tests are Vitest. Add integration tests for event-flow changes. Do not run `npm run format` without checking which untracked files it could touch; format changed files only.
