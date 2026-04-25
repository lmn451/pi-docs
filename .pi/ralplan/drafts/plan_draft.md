# Implementation Plan — Doc Injector Extension for Pi

> Draft 3 — Planner (revised per Architect + Critic feedback)

---

## Architecture Decision Record (ADR)

### ADR-1: Event Strategy — DETECTION vs INJECTION
- **Decision:** Use `message_update` for keyword DETECTION (replacing buffer on each update), use `message_end` to finalize match set, use `before_agent_start` for INJECTION into system prompt
- **Drivers:** `message_update` contains the FULL message content (replaced each time, not appended). `message_end` confirms the message is complete. `before_agent_start` can modify the system prompt for the next turn WITHOUT triggering an extra response.
- **Alternatives considered:**
  - `pi.sendMessage(steer)` → triggers an unsolicited extra LLM response, disruptive to user
  - `context` event modification → loses transparency about what was injected
  - `pi.sendUserMessage(nextTurn)` → queues for next user prompt but may be confusing
- **Consequences:** Docs are available for the next user turn without triggering an extra response. Injection is done by modifying the system prompt via `before_agent_start`.

### ADR-2: Injection Format — System Prompt Append
- **Decision:** Inject as a system prompt append via `before_agent_start`:
  ```
  return {
    systemPrompt: event.systemPrompt + "\n\n## Relevant Context Documents\n{formatted docs}"
  }
  ```
- **Drivers:** System prompt modifications are invisible to the user but available to the model. No extra response triggered.
- **Alternatives considered:** Custom message in chat → visible but triggers extra response; `context` event → modifies messages array, more complex
- **Consequences:** User won't see which docs were injected unless they check TUI notification. Add `ctx.ui.notify()` to inform user.

### ADR-3: Buffer Logic — REPLACE, Not Append
- **Decision:** `message_update` REPLACES the buffer on each call (not appends)
- **Drivers:** `message_update` contains the FULL current message content, not incremental tokens. Each update replaces the previous content.
- **Consequences:** Simpler logic — just replace buffer and run matcher on full content each time.

### ADR-4: Deduplication — Per-Message Tracking
- **Decision:** Track matched docs using a Set per message completion cycle
- **Drivers:** Same doc could match multiple times during streaming. Only inject once per message.
- **Consequences:** Clean deduplication without relying solely on the `injected` flag.

### ADR-5: Frontmatter Parsing
- **Decision:** Custom lightweight parser (split on `---`, extract `keywords` array and `title`)
- **Drivers:** Only need two fields; avoids npm dependency
- **Consequences:** Parser handles only simple YAML arrays; complex frontmatter not supported

### ADR-6: Keyword Matching
- **Decision:** Word boundary regex, case-insensitive, configurable threshold (default: 2)
- **Drivers:** Balance between recall and precision
- **Consequences:** Some docs may be missed if keywords don't match exactly; threshold is tunable

### ADR-7: Configurable Docs Path
- **Decision:** Read from `.pi/doc-injector.json` config file, fallback to `./docs/`
- **Drivers:** User may want different docs path per project
- **Format:**
  ```json
  {
    "docsPath": "./docs",
    "matchThreshold": 2
  }
  ```

---

## Task Breakdown

### Task 1: Project Setup, Types & Interfaces
**Files:**
- `.pi/extensions/doc-injector/types.ts`
- `.pi/extensions/doc-injector/index.ts` (skeleton)
- `.pi/extensions/doc-injector/config.ts`

**Description:**
- Define `DocEntry`, `MatcherOptions`, `MatchResult`, `DocInjectorConfig` interfaces
- Create `config.ts` to load `.pi/doc-injector.json` with defaults
- Create extension entry point with async factory function
- Wire up event stubs: `session_start`, `resources_discover`, `message_update`, `message_end`, `before_agent_start`
- Implement enabled/disabled state flag

**Acceptance Criteria:**
- [ ] TypeScript compiles via jiti without errors
- [ ] Extension loads with `pi -e .pi/extensions/doc-injector/index.ts`
- [ ] Config loads from `.pi/doc-injector.json` with defaults
- [ ] All event handlers are wired (no-op stubs)

### Task 2: Document Registry
**Files:**
- `.pi/extensions/doc-injector/registry.ts`

**Description:**
- Implement `DocRegistry` class:
  - `static create(docsPath: string): Promise<DocRegistry>` — factory that scans and parses
  - `rebuild(): Promise<void>` — re-scan docs folder
  - `getEntries(): DocEntry[]`
  - `getNonInjectedEntries(): DocEntry[]`
  - `reset(): void` — clears all `injected` flags
  - `parseFrontmatter(content: string): { title: string; keywords: string[]; body: string } | null`
- Handle missing docs folder gracefully (warn, return empty)
- Handle docs without frontmatter (warn, skip)

**Acceptance Criteria:**
- [ ] Reads all `.md` files from configured docs folder
- [ ] Extracts keywords and title from YAML frontmatter
- [ ] Missing docs folder → warning, empty registry
- [ ] No frontmatter → warning, skip doc
- [ ] `reset()` clears injected flags
- [ ] `rebuild()` re-scans folder

### Task 3: Keyword Matcher
**Files:**
- `.pi/extensions/doc-injector/matcher.ts`

**Description:**
- Implement `KeywordMatcher` class:
  - `constructor(entries: DocEntry[], options?: Partial<MatcherOptions>)`
  - `match(text: string): MatchResult[]`
  - Builds case-insensitive word boundary regex: `/\b(kw1|kw2|...)\b/gi`
  - Applies threshold filter (default: 2)
  - Filters already-injected docs
  - `extractText(content: unknown): string` — extracts text from message content
- Text extraction handles: string, content array with text/thinking blocks

**Acceptance Criteria:**
- [ ] Word boundary matching works correctly
- [ ] Case-insensitive matching
- [ ] Threshold filtering
- [ ] Already-injected docs excluded
- [ ] Text extraction handles string and array formats

### Task 4: Context Injector
**Files:**
- `.pi/extensions/doc-injector/injector.ts`

**Description:**
- Implement `ContextInjector` class:
  - `constructor(pi: ExtensionAPI)`
  - `buildSystemPromptAppend(entries: DocEntry[], matchedKeywords: Map<DocEntry, string[]>): string`
  - Formats docs as:
    ```
    ## Relevant Context Documents

    ### {title}
    Matched keywords: {kw1}, {kw2}
    ---
    {content}
    ```
  - `notify(ctx: ExtensionContext, entries: DocEntry[], matchedKeywords: Map): void`
  - TUI notification for each injected doc

**Acceptance Criteria:**
- [ ] System prompt append contains formatted docs
- [ ] TUI notification shows filename and matched keywords
- [ ] Multiple docs formatted correctly in single append
- [ ] `entry.injected` flag set after formatting

### Task 5: Event Wiring & Core Logic
**Files:**
- `.pi/extensions/doc-injector/index.ts`

**Description:**
- Wire up all event handlers:
  - `session_start` → load config, create DocRegistry, initialize state
  - `message_update` → if assistant role, extract text, REPLACE buffer, run matcher, store matches in Set
  - `message_end` → if assistant role and matches found, store matched docs for next `before_agent_start`, clear buffer
  - `before_agent_start` → if matched docs pending, inject into system prompt, notify user, clear pending matches
  - `resources_discover` → rebuild registry on reload
- State management:
  - `enabled: boolean`
  - `textBuffer: string`
  - `pendingMatches: Map<DocEntry, string[]>`
  - `matchedDocIds: Set<string>` (per-message dedup)

**Acceptance Criteria:**
- [ ] `message_update` replaces buffer, runs matcher on each update
- [ ] `message_end` finalizes match set for the message
- [ ] `before_agent_start` injects matched docs into system prompt
- [ ] No extra response triggered by injection
- [ ] Toggle state prevents injection when disabled
- [ ] Registry rebuilds on `/reload`
- [ ] Buffer cleared after each `message_end`
- [ ] Pending matches cleared after `before_agent_start`

### Task 6: Commands
**Files:**
- `.pi/extensions/doc-injector/commands.ts`

**Description:**
- Register commands:
  - `/doc-inject on` — enable
  - `/doc-inject off` — disable
  - `/doc-inject toggle` — toggle
  - `/doc-status` — show status (enabled, docs count, injected count)
  - `/doc-reload` — rebuild registry
  - `/doc-inject list` — list all docs with keywords
  - `/doc-inject reset` — reset injected flags

**Acceptance Criteria:**
- [ ] All commands show TUI notifications
- [ ] `/doc-status` shows: enabled state, total docs, injected count
- [ ] `/doc-inject list` shows: filename, title, keywords, injected status
- [ ] `/doc-reload` rebuilds and confirms
- [ ] `/doc-inject reset` clears flags

### Task 7: Example Documents
**Files:**
- `docs/test-md.md`
- `docs/workflow-md.md`
- `docs/publish-md.md`

**Description:**
- Create example documents with proper frontmatter and content

**Acceptance Criteria:**
- [ ] Valid YAML frontmatter with `title` and `keywords`
- [ ] Keywords relevant to content
- [ ] At least 3 example docs

### Task 8: Unit Tests
**Files:**
- `.pi/extensions/doc-injector/test/registry.test.ts`
- `.pi/extensions/doc-injector/test/matcher.test.ts`
- `.pi/extensions/doc-injector/test/injector.test.ts`
- `.pi/extensions/doc-injector/test/run.ts`

**Description:**
- Use Node.js built-in `assert` module
- Mock ExtensionAPI with simple stubs
- Test runner: `node .pi/extensions/doc-injector/test/run.ts`
- Tests:
  - Frontmatter parsing: valid, invalid, missing, multiline keywords
  - Keyword matching: word boundaries, case insensitivity, threshold, dedup
  - System prompt formatting: single doc, multiple docs, empty

**Acceptance Criteria:**
- [ ] All tests pass with `node test/run.ts`
- [ ] Edge cases covered
- [ ] No external test dependencies

---

## Dependency Graph

```
Task 1 (Types, Config, Setup)
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
Task 2 (Registry)  Task 3 (Matcher)  Task 7 (Example Docs)
    │                  │
    └────────┬─────────┘
             ▼
      Task 4 (Injector)
             │
             ▼
      Task 5 (Event Wiring)
             │
             ▼
      Task 6 (Commands)

Task 8 (Tests) — parallel with Tasks 2-4
```

**Execution order:** 
1. Task 1
2. Tasks 2, 3, 7, 8 (parallel)
3. Task 4
4. Task 5
5. Task 6

---

## Acceptance Criteria per Task

| Task | Criteria | Verification |
|------|----------|-------------|
| 1 | Extension loads, config works | `pi -e` starts, config loads |
| 2 | Registry scans and parses | Test with mock .md files |
| 3 | Matcher finds correct keywords | Test with sample text |
| 4 | Injector formats system prompt | Verify output string |
| 5 | Events fire correctly, injection works | End-to-end test |
| 6 | All commands work | Manual testing |
| 7 | Example docs parse correctly | Registry loads them |
| 8 | Unit tests pass | `node test/run.ts` |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1: Context window overflow | Medium | High | Check `ctx.getContextUsage()` before injection; skip if >80% |
| R2: Frontmatter parsing edge cases | Medium | Medium | Try/catch; warn and skip problematic docs |
| R3: False positives from keyword matching | High | Medium | Default threshold 2; user-tunable |
| R4: Missed relevant docs | Medium | Medium | Support multi-word keywords; synonyms in frontmatter |
| R5: `before_agent_start` system prompt append conflicts with other extensions | Medium | Medium | Append to existing systemPrompt (chained); extensions run in load order |
| R6: Docs folder missing | High | Low | Warn, don't crash |
| R7: jiti compilation errors | Low | High | Keep types simple; test with `pi -e` |
| R8: `message_update` text extraction fails on complex content | Medium | Medium | Try/catch with fallback to empty string; log errors |
