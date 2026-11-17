# Pi Doc Injector

A [Pi](https://pi.dev) extension that adds relevant project docs to the conversation as a `CustomMessage`. It does not change the system prompt.

## Install

```bash
pi install npm:pi-doc-injector
```

Requires Pi 1.5.2 or newer within the 1.x series.

## Simple mode (default)

Create `docs/auth.md`. When **auth** appears as a complete word in a user message, assistant text, or assistant thinking, the extension selects that file. Matching ignores case. A user match injects the doc before the assistant responds. An assistant match injects it at Pi's completed `turn_end` boundary, after the assistant response and any tool results are saved. Pi persists a `custom_message` entry and continues the **same** run with the document available to the next provider request.

Simple mode scans the full user input and each finished assistant thinking/text block independently. It does not scan streaming chunks or use a sliding window. For example, a streamed `auth` prefix that finishes as `authentication` does not match `auth.md`; words and phrases cannot be assembled across blocks.

The current provider request cannot be changed retroactively: text or tool calls already generated finish before the document is added. The extension never aborts generation, edits the completed response, or sends a synthetic user `continue` message. Aborted and failed turns do not trigger document injection or continuation.

There is **one automatic document injection batch per user run**, with all matching documents in that batch. This fixed limit also applies to turns with tools: Pi's natural tool or steering continuation satisfies the same next request, so no extra request is added after it. Further matches wait for the next user run and produce one notification. Low-level agent restarts/retries do not reset the limit. A new user run resets it; user-input injection does not consume it. This bounds automatic document-triggered continuation chains.

Simple mode uses only top-level `docs/{name}.md` files. For example, `docs/auth.md` matches `auth`, but not `authentication`. It does not split filenames into words: `docs/api-auth.md` matches `api-auth`, not `auth`. Frontmatter and generated keywords are not needed. Each file is selected for injection at most once per extension session, unless you run `/doc-inject reset`.

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
- `contextThreshold`: Skip injection and notify if current context usage exceeds this percentage, including at the same-run boundary. This checks existing usage rather than estimating the size of the added documents.
- `include`, `exclude`, `maxFileSize`, and `maxConcurrent` control scanning. Symlinked files are skipped.

### Keyword mode (opt-in)

Set `"mode": "keywords"` to use frontmatter keywords, heuristic keyword generation, or optional LLM keyword generation. It also supports nested docs and `.txt` files. The existing `matchThreshold` (default: 2), `streamWindowSize` (default: 500), `recursive`, `autoKeywords`, `llmKeywords`, and `llmBatchSize` settings apply to this mode. Keyword-mode assistant matches still accumulate across streaming updates and wait for the next agent run; they do not request same-run continuation. Neither mode aborts an active response. `streamWindowSize` and `matchThreshold` do not affect simple matching.

Cache writes merge under Pi's per-file mutation queue for heuristic and LLM updates. This coordinates writers only within the Pi process; it is not a cross-process lock or an atomic filesystem transaction.

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
| `/doc-inject history`             | Show saved injection history           |
| `/doc-reload`                     | Re-scan the docs folder                |
| `/doc-keywords-gen [path]`        | Generate keywords in keyword mode only |

### Injection history

`/doc-inject history` shows the latest 20 document records from the current native session branch. Use `/doc-inject history 5` for a positive count or `/doc-inject history all` for the full history. The output includes how many entries are shown out of the total. There is no keyboard shortcut; the slash command is the convenient entry point.

The history is newest-first and has one record per document in each saved injection message. It shows the session entry's UTC persistence timestamp, relative document path, matching mode, keyword source (`filename`, `frontmatter`, `cache`, `llm`, or `heuristic`), matched terms grouped by `input` or `assistant` (text/thinking), injection boundary (`before_agent_start` or `turn_end`), and optional `turnIndex`.

Reason metadata is versioned and stored in `details` on the existing Pi custom messages; it does not duplicate document bodies or write a separate `debug.log`. The history reflects saved injection messages, not an acknowledgement that the model received or read the documents. It is read from native current-branch session history on each command, so it survives extension reload; in-memory injection marks are separate and are rebuilt on reload. Older injection messages without usable reasons metadata are reported unavailable by the command rather than assigned guessed reasons.

## Documentation authoring skill

The repository includes `skills/doc-authoring/SKILL.md` for creating and
validating docs folders. It defaults to top-level filename matching, supports
opt-in keyword mode, and checks file eligibility, sizes, links, and runtime
registration without resetting injection state automatically.

To install it globally from a repository checkout:

```bash
mkdir -p ~/.pi/agent/skills/doc-authoring
cp skills/doc-authoring/SKILL.md ~/.pi/agent/skills/doc-authoring/SKILL.md
```

Run `/reload` in an active Pi session, then use
`/skill:doc-authoring create or validate this project's docs folder`.

## Development

```bash
npm test
npm run typecheck
npm run format:check
```

The runtime glob filter uses `minimatch`. Pi supplies the required
`@earendil-works/pi-coding-agent` and `typebox` peer APIs; local development
installs them as dev dependencies, and tests run with Vitest 4.1.12. Its current
Vite 8.3.8 toolchain resolves vulnerable `picomatch@4.0.7`
(GHSA-fc5q-39xc-vjpf); npm audit also flags the related `tinyglobby`, `fdir`,
Vite, and Vitest development-graph nodes. This is dev-only, not the runtime glob
engine; no patched picomatch release is available.

Lifecycle tests cover full input and long completed thinking/output, block boundaries and partial words, persisted same-run injection, duplicate suppression, abort/error outcomes, the continuation limit, context guards, and keyword-mode streaming regressions.

Injection marks live in memory. Reloading the extension rebuilds this state; it does not reconstruct marks from saved or compacted history.

Pi commits returned messages and boundary entries after the handler returns and has no extension callback for successful persistence. The extension marks files immediately before returning a prepared injection; another extension rejecting or replacing the boundary proposal can therefore leave a file marked without its content being saved. `/doc-inject reset` allows retrying it.

## License

MIT
