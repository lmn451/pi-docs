# AGENTS.md — Operating Manual for AI Agents

This file gives an AI agent the context to work on `pi-doc-injector`
without having to reverse-engineer the codebase. Read this before
making non-trivial changes.

## What This Is

A [Pi](https://pi.dev) extension that watches streaming assistant
output for keyword matches and auto-injects relevant project docs into
the LLM context as a `CustomMessage`. The system prompt is **never**
modified — the CustomMessage goes into the conversation prefix so the
provider's prompt cache stays warm across turns.

- npm package: [`pi-doc-injector`](https://www.npmjs.com/package/pi-doc-injector)
- Source: <https://github.com/lmn451/pi-docs>

## The Streaming Model (read this first)

This extension is built around a specific contract with Pi's event
stream. Misunderstanding it is the #1 source of bugs in this repo.

```
message_update  fires on every streaming chunk
                .message.content = FULL accumulated assistant text
                (not just the new delta)
                → we REPLACE textBuffer on every event, not append

message_end     fires once when the response completes
                → resets textBuffer and streamHits

before_agent_start
                fires before the next agent loop
                → this is where injection happens (returns a message)
                → this is the only place we can inject mid-session
```

Why this matters: `textBuffer` is always the full text-so-far, not a
delta. The matcher is called with this full text every chunk. The
matcher itself can choose to scan only a tail window
(`windowSize > 0`) to bound per-chunk cost; see `matcher.ts`.

The streaming path uses a **discovery matcher** with `matchThreshold:
1` and accumulates distinct keywords into a `streamHits` Set keyed by
filePath. The real `matchThreshold` is then applied against the Set's
size, not the current chunk's hits. This is why keywords can scroll
out of the window but still contribute to crossing the threshold
across chunks. See `index.ts` `message_update` handler.

## The Injection Lifecycle

```
1. session_start        → loadConfig, loadCache, build DocRegistry
2. message_update       → match against textBuffer, populate
                          pendingMatches (and streamHits)
                          → on first NEW match for an unjjected doc
                            with ctx.isIdle() == false: ctx.abort()
                            (the auto-abort feature)
3. message_end          → reset textBuffer, streamHits
4. before_agent_start   → if pendingMatches is non-empty:
                          a) skip if context usage > contextThreshold
                          b) build CustomMessage content via injector
                          c) registry.markInjected(filePaths)
                          d) notifyInjection (TUI)
                          e) pendingMatches.clear()
                          f) return { message: { customType: "doc-injector", ... } }
5. agent_end            → if auto-abort fired, sendUserMessage("continue")
                          to restart the turn with the new context
```

## Double-Injection Prevention (do not break this)

Two independent guards make duplicate injection impossible in a session:

1. **Matcher guard** — `buildMatcher()` calls
   `registry.getNonInjectedEntries()` so already-injected docs are
   excluded from the candidate set. Once a doc is in
   `pendingMatches` and gets injected, the next `buildMatcher()`
   won't see it.
2. **Mark guard** — `markInjected()` runs inside
   `before_agent_start` AFTER the build step but BEFORE the return
   value is processed. The flag flips synchronously with the LLM
   call.

These are redundant by design. **If you change either one, both must
still work.** There are tests in `test/integration/...` that exercise
this — they all use a fresh `MockExtensionAPI` per test, but the
serial-flags invariant is what they're really verifying.

## Module Map

| File             | Role                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`       | Extension entry point. All `pi.on(...)` event handlers. Owns the streaming state (`textBuffer`, `streamHits`, `pendingMatches`, `abortingForInjection`).           |
| `matcher.ts`     | `KeywordMatcher` class. Precompiled regex per keyword with smart word boundaries. Optional `windowSize` for tail-window scanning.                                  |
| `registry.ts`    | `DocRegistry` — scans docs folder, parses frontmatter, manages the `injected` flag, owns the keyword cache merge. The largest module (~570 lines).                 |
| `injector.ts`    | Builds the `CustomMessage` content from matched docs. `sanitizeKeywords` here is the prompt-injection defense for keyword display.                                 |
| `commands.ts`    | All `/doc-*` slash commands. Each one is a thin wrapper around registry/config state.                                                                              |
| `config.ts`      | Loads `.pi/doc-injector.json` with `clampInt` validation. All numeric fields are clamped to a documented range and warned via `Notifier` on out-of-range.          |
| `cache.ts`       | `KeywordCache` persistence at `.pi/doc-injector-cache.json`. Sentinel value `LLM_CACHE_SENTINEL = -1` in `types.ts` marks LLM-written entries — see comment there. |
| `keyword-gen.ts` | Heuristic keyword generation (filename parts, headings, code symbols, stop-word filter).                                                                           |
| `keyword-llm.ts` | Builds the prompt and registers the `_doc_injector_keywords` tool. The tool is defined inline in `index.ts` to close over the cache.                               |
| `notifier.ts`    | Buffers warnings emitted before the live context is bound (during `loadConfig`/`loadCache`/startup), flushes via `ctx.ui.notify()` in `session_start`.             |
| `globber.ts`     | Thin picomatch wrapper for `include`/`exclude` patterns.                                                                                                           |
| `types.ts`       | All shared types. The `LLM_CACHE_SENTINEL` constant lives here.                                                                                                    |

## Commands

```bash
npm test              # vitest run (156 tests across 12 files)
npm run test:watch    # vitest watch
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write .
npm run format:check  # prettier --check .  (CI + pre-push)
```

There is **no build step** — Pi loads `index.ts` directly via tsx.
The `package.json` `main` is `"./index.ts"`. Publishing uses the
declared `files` glob (`*.ts`, `*.d.ts`, `docs/**/*.md`, `README.md`).

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`,
  `refactor:`, `test:`, `docs:`). One concern per commit.
- **Breaking changes**: include a `BREAKING CHANGE:` footer in the
  commit body. The 1→2 `matchThreshold` default bump was the most
  recent (v0.6.0).
- **Versioning**: semver, MINOR for new features, PATCH for fixes.
  Bump in `package.json`, commit, tag `vX.Y.Z`, push tag (triggers
  publish workflow via OIDC, no token).
- **Formatting**: Prettier defaults (`{}` config), enforced by
  pre-push hook + CI. Don't add a `.prettierrc` unless the team
  agrees — Prettier's whole point is to remove config debates.
- **Tests**: vitest. New features need both unit tests (in
  `test/*.test.ts`) and integration tests (in
  `test/integration/*.test.ts`) when the change touches the
  extension's event flow.

## Critical Invariants (do not break)

1. **System prompt is never modified.** Injection is always via
   `before_agent_start` returning a `CustomMessage` (see
   `index.ts:395-402`). Any patch that touches `systemPrompt` is
   wrong.
2. **`message_end` clears `textBuffer` and `streamHits` BEFORE the
   role/registry guards** (since the multi-chunk accumulation fix
   in v0.6.0). Don't move the clears back below the guards without
   re-reading the corresponding integration test.
3. **`pendingMatches` is keyed by `filePath`, not `DocEntry` object
   identity.** `buildMatcher()` can rebuild the registry mid-turn
   (via `resources_discover`); using a reference as a key would
   silently leak.
4. **`matcher.regex.test()` is called against `scanText`, not the
   full text** (when `windowSize > 0`). Don't change this without
   verifying the per-chunk scan cost.
5. **`sanitizeKeywords` in `injector.ts` is the only line of defense
   against prompt injection through the keyword display.** Don't
   remove the `\n`/`\r` strip, the 100-char cap, or the 20-keyword
   hard limit without a security review.
6. **`LLM_CACHE_SENTINEL = -1`** is a load-bearing constant. See the
   comment in `types.ts` for why. The only code that writes it is
   the `_doc_injector_keywords` tool in `index.ts`.

## Known Gotchas

- **`ctx.abort()` + `"continue"` in `agent_end` conflicts with
  async subagent workflows.** Documented in
  `docs/async-subagent-bug.md`. The auto-abort feature is opt-in by
  default (it's always on, but only fires when `isIdle() == false`).
  If you change the auto-abort behavior, re-read that doc.
- **The integration tests in `test/integration/injector-integration.test.ts`
  use a single `message_update` with the full content per "stream"
  via the `triggerAssistantStream` helper.** This means multi-chunk
  accumulation logic in `index.ts` was historically untested. As of
  v0.6.0 there's a dedicated `Multi-Chunk Stream Accumulation`
  describe block that exercises the multi-chunk path — if you
  change the accumulation, add tests there.
- **`input` event fires for user messages; `message_update` only
  fires for assistant messages.** The `input` handler in `index.ts`
  is what populates `pendingMatches` from user input so docs are
  injected in time for the assistant's immediate response (no
  one-turn delay).
- **The LLM keyword generator races with the heuristic scan.** A
  real mtime is overwritten with `LLM_CACHE_SENTINEL` on purpose —
  see the `safeSaveCache` function in `index.ts` for the merge
  logic that handles this.

## Where to Look for Detail

| Topic                       | File                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| Streaming/injection model   | `index.ts` top-of-file comment block (lines 6–65)                       |
| CI/CD                       | `.github/workflows/publish.yml` + `docs/publish.md`                     |
| Subagent interaction issues | `docs/async-subagent-bug.md`                                            |
| Repo workflow               | `docs/workflow-md.md`                                                   |
| Testing conventions         | `docs/test-md.md`                                                       |
| JS runtime / npm            | `docs/bun.md`                                                           |
| Original feature spec       | Was in `PLAN.md` (deleted in v0.6.0); recreate from `git log` if needed |
