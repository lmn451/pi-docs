# Technical Specification — Doc Injector Extension for Pi

## 1. Tech Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Native to pi extension system, runs via jjit without compilation |
| Schema | TypeBox (`typebox`) | Standard for pi tool parameters, built-in validation |
| No npm deps | Built-in only | Extensions should be self-contained; pi provides `@mariozechner/pi-coding-agent`, `typebox`, `@mariozechner/pi-ai` |
| File I/O | `node:fs/promises` + `node:path` | Standard Node.js, no external deps needed |
| Frontmatter parsing | Custom lightweight parser | Avoid adding `gray-matter` or `yaml` dependency; only need `keywords` and `title` fields |

## 2. Architecture Overview

### Pattern: Event-Driven Keyword Matcher with Registry

```
┌─────────────────────────────────────────────────────┐
│                   Extension Entry                    │
│  (doc-injector/index.ts)                             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  DocRegistry  │◄───│  resources_discover      │   │
│  │  (in-memory)  │    │  session_start           │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │ scan & parse docs/*.md                     │
│         ▼                                            │
│  ┌──────────────┐                                    │
│  │  DocEntry[]   │  [{ file, title, keywords,       │
│  │               │    content, injected: boolean }]  │
│  └──────┬───────┘                                    │
│         │ match                                      │
│         ▼                                            │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  KeywordMatcher│───│  message_update /        │   │
│  │               │    │  message_end             │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │ found match                                │
│         ▼                                            │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  ContextInjector│──│  message_end             │   │
│  │               │    │  (queue steer message)   │   │
│  └──────────────┘    └──────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Layers:
1. **DocRegistry** — Scans `docs/` folder, parses frontmatter, maintains in-memory index
2. **KeywordMatcher** — Matches streaming output text against keyword index
3. **ContextInjector** — Queues document content as a steer message when match detected
4. **Command & Config** — `/doc-inject` commands for toggle, status, reload

## 3. File Structure

```
.pi/extensions/
└── doc-injector/
    ├── index.ts          # Extension entry point, event wiring
    ├── registry.ts       # DocRegistry: scan, parse, index documents
    ├── matcher.ts        # KeywordMatcher: streaming text → keyword match
    ├── injector.ts       # ContextInjector: queue steer messages
    ├── commands.ts       # Slash commands: /doc-inject, /doc-status, /doc-reload
    └── types.ts          # Shared type definitions
docs/
    ├── test-md.md         # Example: testing workflow doc
    ├── workflow-md.md     # Example: general workflow doc
    └── publish-md.md      # Example: publishing workflow doc
```

## 4. Dependencies

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Extension types, events, API |
| `typebox` | Schema definitions |
| `node:fs/promises` | File system operations |
| `node:path` | Path resolution |

No `package.json` needed — zero external npm dependencies.

## 5. API / Interface Definitions

### 5.1 DocEntry Type

```typescript
interface DocEntry {
  filePath: string;      // Absolute path to the .md file
  fileName: string;      // e.g., "test-md.md"
  title: string;         // From frontmatter or filename
  keywords: string[];    // From frontmatter (required)
  content: string;       // Full markdown content
  injected: boolean;     // Whether already injected this session
}
```

### 5.2 Frontmatter Format

```markdown
---
title: "Testing Workflow"
keywords:
  - test
  - testing
  - unit test
  - tdd
  - jest
  - vitest
---

# Testing Workflow
...
```

### 5.3 KeywordMatcher Interface

```typescript
class KeywordMatcher {
  constructor(entries: DocEntry[], options: MatcherOptions);
  
  // Returns DocEntry[] that matched the text
  match(text: string): DocEntry[];
  
  // Reset injection state
  reset(): void;
}

interface MatcherOptions {
  matchThreshold: number;     // Min keyword hits to trigger (default: 2)
  caseSensitive: boolean;     // Case-insensitive matching (default: false)
  wordBoundary: boolean;      // Use \b word boundaries (default: true)
}
```

### 5.4 ContextInjector Interface

```typescript
class ContextInjector {
  constructor(pi: ExtensionAPI, ctx: ExtensionContext);
  
  // Queue a document as a steer message
  inject(entry: DocEntry): void;
  
  // Build the injection message content
  buildMessage(entry: DocEntry): string;
}
```

### 5.5 Commands

| Command | Description |
|---------|-------------|
| `/doc-inject on` | Enable auto-injection |
| `/doc-inject off` | Disable auto-injection |
| `/doc-inject toggle` | Toggle on/off |
| `/doc-status` | Show registered docs, keywords, injection state |
| `/doc-reload` | Re-scan docs folder and rebuild registry |
| `/doc-inject list` | List all registered documents with keywords |

## 6. Event Flow

```
session_start
  └─► DocRegistry.scan(docsPath) → build index

message_update (streaming)
  └─► KeywordMatcher.match(extractedText)
      └─► If match found AND not yet injected:
          └─► ContextInjector.inject(entry)
              └─► pi.sendMessage({ deliverAs: "steer" })
                  └─► TUI notification: "📄 Injected: test-md.md (matched: test, testing)"

message_end
  └─► (no-op; injection already queued via steer)

resources_discover (reload)
  └─► DocRegistry.scan(docsPath) → rebuild index
```

## 7. Key Design Decisions

### 7.1 Injection Timing: `message_end` vs `message_update`
- **Decision:** Monitor `message_update` for keyword detection, but inject via `message_end` 
- **Rationale:** `message_update` fires per-token during streaming — too noisy for injection. 
  Detect keywords during streaming, but only inject once the message completes to avoid mid-turn disruption.
- **Alternative considered:** Use `context` event to modify messages before next LLM call — 
  rejected because it would require accumulating state across turns.

### 7.2 Injection Method: `sendMessage` with `deliverAs: "steer"`
- **Decision:** Use `pi.sendMessage()` with custom message type
- **Rationale:** Makes injection visible in chat history (transparent to user), 
  triggers LLM response on next turn, and doesn't pollute system prompt
- **Alternative considered:** Modify `context` event to insert as user message — 
  rejected because it's less transparent and harder to debug

### 7.3 Keyword Matching: Word Boundary Regex
- **Decision:** Use `\bkeyword\b` word boundary matching, case-insensitive
- **Rationale:** Prevents false positives from substrings (e.g., "test" matching "testing" is fine, 
  but "art" shouldn't match "artifact"). Case-insensitive for usability.

### 7.4 Frontmatter Parsing: Custom Lightweight Parser
- **Decision:** Parse YAML frontmatter manually (split on `---`, simple key extraction)
- **Rationale:** Avoid npm dependency for a simple task. Only need `keywords` array and `title` string.
- **Alternative considered:** Use `gray-matter` npm package — rejected for dependency simplicity.

## 8. Acceptance Criteria

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC-1 | Extension loads without errors | `pi -e .pi/extensions/doc-injector/index.ts` starts cleanly |
| AC-2 | Docs folder is scanned on session start | `/doc-status` shows all docs/*.md files |
| AC-3 | Keywords from frontmatter are parsed correctly | Test doc with `keywords: [test, testing]` matches both |
| AC-4 | Keyword matching detects relevant output | Ask "how do I write a test?" → test-md.md is injected |
| AC-5 | Already-injected docs are not re-injected | Same keywords in consecutive turns → doc injected only once |
| AC-6 | User is notified of injection | TUI shows notification with doc name and matched keywords |
| AC-7 | Toggle works | `/doc-inject off` stops all injections |
| AC-8 | Reload picks up new docs | Add new doc → `/doc-reload` → it appears in registry |
| AC-9 | No false positives from substrings | Output containing "art" does NOT trigger "artifact" doc |
| AC-10 | Configurable docs path | Settings can override default `./docs/` path |
