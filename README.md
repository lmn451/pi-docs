# Pi Doc Injector

A [Pi](https://pi.dev) extension that adds relevant project docs to the conversation as a `CustomMessage`. It does not change the system prompt.

## Install

```bash
pi install npm:pi-doc-injector
```

Requires Pi 1.5.2 or newer within the 1.x series.

## Simple mode (default)

Create `docs/auth.md`. When **auth** appears as a complete word in a user message, assistant text, or assistant thinking, the extension selects that file. Matching ignores case. A user match injects the doc before the assistant responds. An assistant match injects it before the **next** agent run; it does not abort the current response or send a synthetic `continue` message.

Simple mode uses only top-level `docs/{name}.md` files. For example, `docs/auth.md` matches `auth`, but not `authentication`. It does not split filenames into words: `docs/api-auth.md` matches `api-auth`, not `auth`. Frontmatter and generated keywords are not needed. Each file is injected at most once per session, unless you run `/doc-inject reset`.

The extension stores the injected content in a conversation message, not at the head of the context or in the system prompt. Provider cache hits still depend on the provider's cache policy.

## Configuration

Optional `.pi/doc-injector.json` in your project:

```json
{
  "mode": "simple",
  "docsPath": "./docs",
  "contextThreshold": 80
}
```

- `mode`: `"simple"` (default) or `"keywords"`.
- `docsPath`: Folder to scan, relative to the project root.
- `contextThreshold`: Skip injection if context usage exceeds this percentage.
- `include`, `exclude`, `maxFileSize`, and `maxConcurrent` control scanning. Symlinked files are skipped.

### Keyword mode (opt-in)

Set `"mode": "keywords"` to use frontmatter keywords, heuristic keyword generation, or optional LLM keyword generation. It also supports nested docs and `.txt` files. The existing `matchThreshold` (default: 2), `streamWindowSize` (default: 500), `recursive`, `autoKeywords`, `llmKeywords`, and `llmBatchSize` settings apply to this mode. Assistant matches still wait for the next agent run; neither mode aborts an active response.

Example doc:

```md
---
title: Authentication
keywords: [auth, login, sign in]
---

# Authentication

Use these project rules...
```

If a file has no frontmatter keywords, keyword mode generates search terms from its filename, headings, and code symbols by default. Set `"autoKeywords": false` to disable that fallback. `/doc-keywords-gen [path]` requests LLM-generated keywords when `"llmKeywords": true`; it does not run in simple mode.

## Commands

| Command                           | Action                                 |
| --------------------------------- | -------------------------------------- |
| `/doc-inject status`              | Show enabled state and document counts |
| `/doc-inject list`                | Show documents and injection state     |
| `/doc-inject on`, `off`, `toggle` | Control injection                      |
| `/doc-inject reset`               | Allow documents to be injected again   |
| `/doc-reload`                     | Re-scan the docs folder                |
| `/doc-keywords-gen [path]`        | Generate keywords in keyword mode only |

## Development

```bash
npm test
npm run typecheck
npm run format:check
```

## License

MIT
