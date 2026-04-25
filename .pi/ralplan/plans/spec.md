# Specification — Doc Injector Extension for Pi

> Auto-inject relevant project documentation into LLM context based on keyword matching during model output.

---

## 1. Requirements Analysis (Analyst)

### 1.1 Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-1** | Document discovery | Scan a `docs/` folder for `.md` files on extension load and on `/reload` |
| **FR-2** | Keyword extraction | Each document declares its keywords via YAML frontmatter (`keywords: [...]`) |
| **FR-3** | Output monitoring | Monitor the LLM's streaming output (`message_update` events) for keyword matches |
| **FR-4** | Context injection | When a keyword match is detected, inject the corresponding document's content into the LLM context |
| **FR-5** | Duplicate prevention | Track already-injected documents to avoid re-injecting the same doc in a single session |
| **FR-6** | Configurable docs path | Allow the user to configure the docs folder path (default: `./docs/`) |
| **FR-7** | Enable/disable toggle | Extension must be toggleable (on/off) without uninstalling |
| **FR-8** | Injection notification | Notify the user (via TUI) when a document is injected, including which doc and why |

### 1.2 Non-Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **NFR-1** | Low latency | Keyword matching must be near-instant (<50ms) to not block streaming |
| **NFR-2** | Context budget awareness | Injected content must respect the model's context window |
| **NFR-3** | Non-disruptive | Injection must not interrupt the current turn or corrupt conversation flow |
| **NFR-4** | Hot-reloadable | Changes to `docs/` folder must be picked up on `/reload` |
| **NFR-5** | No external dependencies | Extension works with built-in pi packages only |

### 1.3 Implicit Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **IR-1** | Frontmatter schema | Standard frontmatter: `keywords: [...]`, `title: ...` |
| **IR-2** | Keyword normalization | Case-insensitive, word-boundary matching |
| **IR-3** | Thinking block detection | Monitor `<think>` blocks for keywords too |
| **IR-4** | Injection timing | Inject as steer message between turns, not mid-stream |
| **IR-5** | Match threshold | Minimum keyword hits (default: 2) before injecting |
| **IR-6** | Session persistence | Track injected docs per-session |

### 1.4 Out of Scope

- Vector/semantic search (keyword-based only)
- Automatic document generation or editing
- Multi-project docs sharing
- GUI configuration panel
- Real-time streaming injection (mid-response)

---

## 2. Technical Specification (Architect)

### 2.1 Tech Stack

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Native to pi, runs via jiti |
| Schema | TypeBox | Standard for pi tool parameters |
| No npm deps | Built-in only | Self-contained; uses `@mariozechner/pi-coding-agent`, `typebox` |
| File I/O | `node:fs/promises` + `node:path` | Standard Node.js |
| Frontmatter parsing | Custom lightweight parser | Only need `keywords` and `title` |

### 2.2 Architecture

**Pattern:** Event-Driven Keyword Matcher with Registry

```
┌─────────────────────────────────────────────┐
│             Extension Entry                  │
│  (doc-injector/index.ts)                     │
├─────────────────────────────────────────────┤
│                                              │
│  DocRegistry ──► scan & parse docs/*.md     │
│       │                                      │
│       ▼                                      │
│  KeywordMatcher ──► match streaming output   │
│       │                                      │
│       ▼                                      │
│  ContextInjector ──► queue steer message     │
│                                              │
│  Commands: /doc-inject, /doc-status,         │
│            /doc-reload                       │
└─────────────────────────────────────────────┘
```

### 2.3 File Structure

```
.pi/extensions/
└── doc-injector/
    ├── index.ts          # Extension entry point, event wiring
    ├── registry.ts       # DocRegistry: scan, parse, index documents
    ├── matcher.ts        # KeywordMatcher: streaming text → keyword match
    ├── injector.ts       # ContextInjector: queue steer messages
    ├── commands.ts       # Slash commands
    └── types.ts          # Shared type definitions
docs/
    ├── test-md.md         # Example doc
    ├── workflow-md.md     # Example doc
    └── publish-md.md      # Example doc
```

### 2.4 Data Types

```typescript
interface DocEntry {
  filePath: string;
  fileName: string;
  title: string;
  keywords: string[];
  content: string;
  injected: boolean;
}

interface MatcherOptions {
  matchThreshold: number;   // default: 2
  caseSensitive: boolean;   // default: false
  wordBoundary: boolean;    // default: true
}
```

### 2.5 Event Flow

```
session_start
  └─► DocRegistry.scan(docsPath) → build index

message_update (streaming)
  └─► KeywordMatcher.match(extractedText)
      └─► If match AND not yet injected:
          └─► ContextInjector.inject(entry)
              └─► pi.sendMessage({ deliverAs: "steer" })

message_end
  └─► (no-op; injection already queued)

resources_discover (reload)
  └─► DocRegistry.scan(docsPath) → rebuild index
```

### 2.6 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Injection timing | Detect on `message_update`, inject on `message_end` | Avoid mid-turn disruption |
| Injection method | `pi.sendMessage()` with `deliverAs: "steer"` | Visible in chat, triggers next turn |
| Keyword matching | Word boundary regex, case-insensitive | Prevents substring false positives |
| Frontmatter parsing | Custom lightweight | No npm dependency needed |

### 2.7 Commands

| Command | Description |
|---------|-------------|
| `/doc-inject on` | Enable auto-injection |
| `/doc-inject off` | Disable auto-injection |
| `/doc-inject toggle` | Toggle on/off |
| `/doc-status` | Show registered docs, keywords, injection state |
| `/doc-reload` | Re-scan docs folder and rebuild registry |
| `/doc-inject list` | List all registered documents with keywords |

---

## 3. Acceptance Criteria

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC-1 | Extension loads without errors | `pi -e .pi/extensions/doc-injector/index.ts` starts cleanly |
| AC-2 | Docs folder is scanned on session start | `/doc-status` shows all docs/*.md files |
| AC-3 | Keywords from frontmatter are parsed correctly | Test doc with `keywords: [test, testing]` matches both |
| AC-4 | Keyword matching detects relevant output | Ask "how do I write a test?" → test-md.md is injected |
| AC-5 | Already-injected docs are not re-injected | Same keywords in consecutive turns → doc injected once |
| AC-6 | User is notified of injection | TUI shows notification with doc name and matched keywords |
| AC-7 | Toggle works | `/doc-inject off` stops all injections |
| AC-8 | Reload picks up new docs | Add new doc → `/doc-reload` → appears in registry |
| AC-9 | No false positives from substrings | Output containing "art" does NOT trigger "artifact" doc |
| AC-10 | Configurable docs path | Settings can override default `./docs/` path |

---

## 4. Requirement Coverage Map

| Requirement | Covered By |
|-------------|------------|
| FR-1 Document discovery | DocRegistry.scan() on session_start + resources_discover |
| FR-2 Keyword extraction | YAML frontmatter parsing in registry.ts |
| FR-3 Output monitoring | message_update event handler with KeywordMatcher |
| FR-4 Context injection | ContextInjector using pi.sendMessage(steer) |
| FR-5 Duplicate prevention | DocEntry.injected flag, reset on session_start |
| FR-6 Configurable path | Extension config via settings or constructor options |
| FR-7 Enable/disable | Boolean flag, controlled by /doc-inject commands |
| FR-8 Notification | ctx.ui.notify() on each injection |
| NFR-1 Low latency | Simple regex matching, O(n) over keyword list |
| NFR-2 Context budget | Future: check ctx.getContextUsage() before injecting |
| NFR-3 Non-disruptive | Steer message delivery between turns |
| NFR-4 Hot-reload | resources_discover triggers DocRegistry.rebuild() |
| NFR-5 No external deps | Custom frontmatter parser, no npm packages |
| IR-1 Frontmatter schema | Documented in spec, enforced by registry parser |
| IR-2 Keyword normalization | Word boundary regex, case-insensitive |
| IR-3 Thinking blocks | Extract text from `message_update` including <think> tags |
| IR-4 Injection timing | message_end triggers steer message |
| IR-5 Match threshold | MatcherOptions.matchThreshold |
| IR-6 Session persistence | In-memory DocEntry[] per session |

---

## 5. Open Questions

See `.pi/ralplan/plans/open-questions.md` for tracking.

Resolved decisions (from spec above):
- **OQ-1 (Matching):** Word boundary regex, case-insensitive ✓
- **OQ-2 (Visibility):** Inject as visible steer message ✓
- **OQ-4 (Max docs per turn):** One injection per matched doc per session (threshold handles false positives) ✓
- **OQ-5 (Glob patterns):** Flat `docs/*.md` for v1, glob support as future enhancement ✓

Pending:
- **OQ-3 (Thinking blocks):** Decide whether to monitor `<think>` content (recommendation: yes, extract all text including thinking blocks for matching)
