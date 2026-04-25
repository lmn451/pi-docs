# Implementation Plan — Doc Injector Extension for Pi

> **Status:** CONSENSUS APPROVED  
> **Pipeline:** RALPLAN  
> **Date:** 2026-04-24

---

## Overview

A pi extension that monitors the LLM's streaming output for keywords and automatically injects relevant project documentation (from a `docs/` folder) into the system prompt for the next turn.

**Core flow:**
1. Extension scans `docs/*.md` files on session start
2. During LLM response streaming (`message_update`), extracts text and matches keywords
3. On message completion (`message_end`), finalizes matched docs
4. On next user prompt (`before_agent_start`), injects matched docs into system prompt
5. No extra response triggered — docs are silently available for the next turn

---

## Architecture Decision Record (ADR)

### ADR-1: Event Strategy — DETECTION vs INJECTION
- **Decision:** `message_update` for detection (replace buffer), `message_end` to finalize, `before_agent_start` for injection into system prompt
- **Drivers:** `message_update` contains full message (replaced each update). `before_agent_start` modifies system prompt without triggering extra response.
- **Alternatives considered:**
  - `pi.sendMessage(steer)` → triggers unsolicited extra response (rejected)
  - `context` event modification → loses transparency (rejected)
  - `pi.sendUserMessage(nextTurn)` → queues for next user prompt but confusing (rejected)
- **Consequences:** Docs available on next user turn. No disruption to current turn.

### ADR-2: Injection Format — System Prompt Append
- **Decision:** Append to system prompt via `before_agent_start` return value
- **Drivers:** Invisible to user, available to model, no extra response
- **Alternatives considered:** Custom message in chat → triggers extra response
- **Consequences:** User notified via TUI but won't see injected content in chat history

### ADR-3: Buffer Logic — REPLACE, Not Append
- **Decision:** `message_update` REPLACES buffer on each call
- **Drivers:** `message_update` contains FULL message content, not incremental tokens
- **Consequences:** Simpler implementation

### ADR-4: Deduplication — Per-Message Set Tracking
- **Decision:** Track matched docs using Set per message completion cycle
- **Drivers:** Same doc could match multiple times during streaming
- **Consequences:** Clean dedup without relying solely on `injected` flag

### ADR-5: Frontmatter Parsing
- **Decision:** Custom lightweight YAML parser (split on `---`)
- **Drivers:** Only need `keywords` and `title` fields; no npm dependency
- **Consequences:** Simple YAML arrays only; complex frontmatter not supported

### ADR-6: Keyword Matching
- **Decision:** Word boundary regex, case-insensitive, threshold ≥ 2
- **Drivers:** Balance recall vs precision
- **Consequences:** Tunable; multi-word keywords supported

### ADR-7: Configurable Docs Path
- **Decision:** `.pi/doc-injector.json` config file, default `./docs/`
- **Drivers:** Per-project flexibility
- **Format:** `{ "docsPath": "./docs", "matchThreshold": 2 }`

---

## File Structure

```
.pi/extensions/
└── doc-injector/
    ├── index.ts              # Extension entry, event wiring
    ├── config.ts             # Config loader (.pi/doc-injector.json)
    ├── types.ts              # Shared type definitions
    ├── registry.ts           # DocRegistry: scan, parse, index
    ├── matcher.ts            # KeywordMatcher: text → keyword match
    ├── injector.ts           # ContextInjector: system prompt formatting
    ├── commands.ts           # Slash commands
    └── test/
        ├── run.ts            # Test runner
        ├── registry.test.ts  # Registry tests
        ├── matcher.test.ts   # Matcher tests
        └── injector.test.ts  # Injector tests
docs/
    ├── test-md.md            # Example: testing workflow
    ├── workflow-md.md        # Example: general workflow
    └── publish-md.md         # Example: publishing workflow
.pi/
└── doc-injector.json         # Optional config file
```

---

## Task Breakdown

### Task 1: Project Setup, Types & Config
**Files:** `.pi/extensions/doc-injector/types.ts`, `config.ts`, `index.ts` (skeleton)
- Define `DocEntry`, `MatcherOptions`, `MatchResult`, `DocInjectorConfig` interfaces
- Create config loader for `.pi/doc-injector.json` with defaults
- Wire up event stubs
- **AC:** Extension loads with `pi -e`, config works

### Task 2: Document Registry
**Files:** `.pi/extensions/doc-injector/registry.ts`
- `DocRegistry.create()`, `rebuild()`, `getEntries()`, `reset()`, `parseFrontmatter()`
- Handle missing docs folder (warn, empty)
- Handle missing frontmatter (warn, skip)
- **AC:** Scans `.md` files, extracts keywords/title from frontmatter

### Task 3: Keyword Matcher
**Files:** `.pi/extensions/doc-injector/matcher.ts`
- `KeywordMatcher.match(text)` → `MatchResult[]`
- Word boundary regex, case-insensitive, threshold filter
- `extractText(content)` → handles string, content array, thinking blocks
- **AC:** Correct word boundary matching, case-insensitive, threshold

### Task 4: Context Injector
**Files:** `.pi/extensions/doc-injector/injector.ts`
- `buildSystemPromptAppend(entries, matchedKeywords)` → formatted string
- `notify(ctx, entries, matchedKeywords)` → TUI notification
- **AC:** Formatted system prompt append, TUI notifications

### Task 5: Event Wiring & Core Logic
**Files:** `.pi/extensions/doc-injector/index.ts`
- `session_start` → load config, create registry
- `message_update` → replace buffer, run matcher, store matches in Set
- `message_end` → finalize matches for next `before_agent_start`
- `before_agent_start` → inject docs into system prompt
- `resources_discover` → rebuild registry
- **AC:** Full event flow works end-to-end

### Task 6: Commands
**Files:** `.pi/extensions/doc-injector/commands.ts`
- `/doc-inject on|off|toggle|list|reset|status`, `/doc-reload`
- **AC:** All commands work with TUI notifications

### Task 7: Example Documents
**Files:** `docs/test-md.md`, `docs/workflow-md.md`, `docs/publish-md.md`
- Valid frontmatter, realistic content
- **AC:** Registry parses all 3 docs successfully

### Task 8: Unit Tests
**Files:** `.pi/extensions/doc-injector/test/*.ts`
- Node.js `assert` module, mocked ExtensionAPI
- **AC:** All tests pass with `node test/run.ts`

---

## Dependency Graph

```
Task 1 (Foundation)
  ├──► Task 2 (Registry) ──┐
  ├──► Task 3 (Matcher) ───┼──► Task 4 (Injector) ──► Task 5 (Event Wiring) ──► Task 6 (Commands)
  ├──► Task 7 (Example Docs) [parallel]
  └──► Task 8 (Tests) [parallel with 2-4]
```

**Execution order:** 1 → {2,3,7,8} → 4 → 5 → 6

---

## Acceptance Criteria

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC-1 | Extension loads without errors | `pi -e` starts cleanly |
| AC-2 | Docs folder scanned on session start | `/doc-status` shows all docs |
| AC-3 | Keywords parsed from frontmatter | Test doc with `keywords: [test, testing]` matches both |
| AC-4 | Keyword matching detects relevant output | Ask "how do I write a test?" → test-md.md injected |
| AC-5 | No re-injection of same doc in session | Same keywords → doc injected only once |
| AC-6 | User notified of injection | TUI notification with doc name and keywords |
| AC-7 | Toggle works | `/doc-inject off` stops injections |
| AC-8 | Reload picks up new docs | Add doc → `/doc-reload` → appears in registry |
| AC-9 | No false positives from substrings | "art" doesn't trigger "artifact" doc |
| AC-10 | Configurable docs path | `.pi/doc-injector.json` overrides default |
| AC-11 | No extra response triggered | Injection happens silently on next turn |
| AC-12 | All unit tests pass | `node test/run.ts` |

---

## Requirement Coverage Map

| Requirement | Covered By |
|-------------|------------|
| FR-1 Document discovery | Task 2: DocRegistry.scan() |
| FR-2 Keyword extraction | Task 2: parseFrontmatter() |
| FR-3 Output monitoring | Task 5: message_update handler |
| FR-4 Context injection | Task 4+5: before_agent_start system prompt append |
| FR-5 Duplicate prevention | Task 5: per-message Set + DocEntry.injected flag |
| FR-6 Configurable path | Task 1: config.ts |
| FR-7 Enable/disable | Task 6: /doc-inject commands |
| FR-8 Notification | Task 4: injector.notify() |
| NFR-1 Low latency | Task 3: O(n) regex matching |
| NFR-2 Context budget | Risk R1 mitigation: getContextUsage() check |
| NFR-3 Non-disruptive | ADR-1: before_agent_start, no extra response |
| NFR-4 Hot-reload | Task 5: resources_discover handler |
| NFR-5 No external deps | ADR-5: custom parser |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1: Context window overflow | Medium | High | Check `ctx.getContextUsage()` before injection; skip if >80% |
| R2: Frontmatter parsing edge cases | Medium | Medium | Try/catch; warn and skip |
| R3: False positives | High | Medium | Default threshold 2; user-tunable |
| R4: Missed relevant docs | Medium | Medium | Multi-word keywords; synonyms in frontmatter |
| R5: System prompt conflicts with other extensions | Medium | Medium | Chained append; load order determines precedence |
| R6: Docs folder missing | High | Low | Warn, don't crash |
| R7: jiti compilation errors | Low | High | Keep types simple; test with `pi -e` |
| R8: Text extraction fails on complex content | Medium | Medium | Try/catch; fallback to empty string |
