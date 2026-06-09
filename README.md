# Pi Doc Injector

A [Pi](https://pi.dev) extension that automatically injects relevant project documentation into the LLM context by monitoring streaming output for keyword matches. Docs are delivered as a `CustomMessage` so the system prompt stays untouched and the provider's prompt cache stays warm.

## Installation

### Via npm (recommended)

```bash
pi install npm:pi-doc-injector
```

### Via git

```bash
pi install git:github.com/lmn451/pi-doc-injector
```

### Manual

Copy this repository into your project's `.pi/extensions/doc-injector/` folder, or clone directly:

```bash
git clone https://github.com/yourname/pi-doc-injector.git .pi/extensions/doc-injector
```

## Quick Start

1. Create a `docs/` folder in your project root.
2. Add markdown files with frontmatter (`title` + `keywords`). See [Document Format](#document-format) for supported formats.
3. Start Pi. The extension scans `docs/` on session start.
4. When the user mentions a keyword, the matching doc is injected as a
   `CustomMessage` into the conversation **before the assistant responds** —
   no one-turn delay. The system prompt is never modified.
5. If the assistant mentions a NEW keyword mid-response, generation is
   automatically aborted and restarted with the doc injected immediately.

## Document Format

Documents are markdown files (`.md` or `.txt`) that the extension scans for injection.
Each file can declare `title` and `keywords` via **frontmatter** — a metadata block at the top of the file.

### Supported Frontmatter Formats

The extension tries formats in this order and uses the first match it finds:

**1. YAML (recommended)**

```md
---
title: "Testing Workflow"
keywords: [test, testing, jest, vitest]
---

# Testing Workflow
```

**2. C-style block comment** — useful for `.ts`/`.js` doc files:

```md
/*---
title: "Testing Workflow"
keywords: [test, testing, jest, vitest]
---*/

# Testing Workflow
```

**3. HTML comment** — useful for HTML-generated docs:

```md
<!--
title: "Testing Workflow"
keywords: [test, testing, jest, vitest]
-->

# Testing Workflow
```

**4. Slash-slash comment** — useful for `.js`/`.ts` sidecar docs:

```md
//---
title: "Testing Workflow"
keywords: [test, testing, jest, vitest]

# Testing Workflow
```

### Keyword Array Syntax

Both **flow** and **block** keyword array syntaxes are supported:

```md
keywords: [test, testing, jest]          # flow: comma-separated in brackets
keywords:                              # block: one per line
  - test
  - testing
  - jest
```

### Auto-Keywords Fallback

If a file has **no frontmatter** and `autoKeywords` is enabled (default: `true`), the extension generates keywords heuristically from the filename and content — no metadata needed.

If `autoKeywords` is `false`, files without valid frontmatter are **skipped** with a warning.

## Configuration

Create `.pi/doc-injector.json` in your project root to customize behavior:

```json
{
  "docsPath": "./docs",
  "matchThreshold": 1,
  "contextThreshold": 80,
  "recursive": true,
  "autoKeywords": true,
  "llmKeywords": false,
  "llmBatchSize": 20
}
```

| Option             | Default    | Description                                              |
| ------------------ | ---------- | -------------------------------------------------------- |
| `docsPath`         | `"./docs"` | Path to docs folder (relative to project root)           |
| `matchThreshold`   | `1`        | Minimum keyword matches required to inject a doc         |
| `contextThreshold` | `80`       | Skip injection when context usage exceeds this % (0–100) |
| `recursive`        | `true`     | Scan docs subdirectories recursively                     |
| `autoKeywords`     | `true`     | Generate keywords heuristically when frontmatter is missing |
| `llmKeywords`      | `false`    | Enable LLM-based keyword generation (see below)          |
| `llmBatchSize`     | `20`       | Max files per LLM keyword batch                          |

### Keyword Matching

Matching is case-insensitive and respects word boundaries by default. Once a document is injected, it won't re-match until you run `/doc-inject reset`.

Injection is also skipped if the current context usage exceeds 80% of the token budget.

## Commands

| Command              | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `/doc-inject on`     | Enable doc injection                                 |
| `/doc-inject off`    | Disable doc injection                                |
| `/doc-inject toggle` | Toggle doc injection on/off                          |
| `/doc-inject list`   | List all registered docs and their injection status  |
| `/doc-inject reset`  | Reset all injected flags (docs become re-injectable) |
| `/doc-inject status` | Show current injection status and config             |
| `/doc-reload`        | Re-scan docs folder and rebuild registry             |
| `/doc-keywords-gen`  | Generate LLM keywords for files without frontmatter (requires `llmKeywords: true` in config) |

## Keyword Generation

When a document has no frontmatter keywords, the extension handles it in two ways:

### Heuristic (Automatic)

If `autoKeywords` is `true` (default), keywords are generated automatically from:

- **Filename parts**: `"api-authentication.md"` → `[api, authentication]`
- **Markdown headings**: `"# Getting Started"` → `[getting, started]`
- **Code symbols**: `"function foo()"` → `[foo]`

All keywords are filtered through a stop-word list, lowercased, and capped at 20.

### LLM Generation (Manual)

For better keywords, enable LLM generation in config:

```json
{
  "autoKeywords": true,
  "llmKeywords": true,
  "llmBatchSize": 20
}
```

Then run `/doc-keywords-gen [path]` to generate keywords via LLM. Without a path argument, it processes all keyword-less files.

The LLM reads each file's content and produces 3–10 relevant, searchable keywords per file. Results are saved to the cache and reused on subsequent scans.

### Keyword Source Tracking

The cache stores which method was used for each file's keywords:

| Source       | How set                                          |
| ------------ | ------------------------------------------------ |
| `frontmatter` | Keywords declared in file frontmatter             |
| `cache`      | Reused from previous scan (mtime match)          |
| `heuristic`  | Auto-generated from filename/content             |
| `llm`        | Generated via `/doc-keywords-gen`                |

Use `/doc-inject list` to see each file's keyword source (shown as `[source]` tag).

## Injection Lifecycle

The extension uses a per-session injection model:

- On `session_start`, the registry scans `docs/` and indexes all valid documents.
- Within a session, once a document is injected, it won't be re-injected automatically.
- Use `/doc-inject reset` to manually reset all flags and allow docs to be injected again.
- Use `/doc-inject list` to see which docs have been injected (✅) and which are pending (⬜).

### Injection Timing

- **User messages**: matched via the `input` event, injected before the assistant
  responds — **same turn**, no delay.
- **Assistant streaming**: if the assistant mentions a NEW keyword mid-response,
  generation is aborted and restarted with the doc injected immediately.

### Injection Mechanism

On match, the extension returns a `message` field from `before_agent_start`
with `customType: "doc-injector"`. Pi appends this to the session and sends
it to the LLM as part of the conversation. The system prompt is **never**
mutated.

#### Why a CustomMessage, not the system prompt?

- The system prompt is the highest-value prompt-cache slot. Each unique
  system prompt text breaks the cache (5-min TTL by default). Appending
  per-turn doc content there would invalidate the cache on every first
  injection.
- A `CustomMessage` only adds to the conversation prefix, leaving the
  system prompt byte-identical across turns and the cache warm.

#### Double-injection prevention

Two independent guards make duplicate injection impossible in a session:

1. **Matcher guard** — `buildMatcher()` only includes non-injected entries
   (via `getNonInjectedEntries()`), so already-injected docs cannot be
   re-matched.
2. **Mark guard** — `markInjected()` runs inside `before_agent_start` before
   the LLM call, so even if the matcher ever produced a duplicate, the
   mark would still prevent a second send.

In practice, the matcher guard is the primary defense; the mark guard is
defense-in-depth for race conditions (e.g. if `resources_discover` rebuilds
the registry mid-injection).

The `injected` flag is per-session: it's reset on `session_start` and can
be manually cleared with `/doc-inject reset`.

For the full source-level verification, see the JSDoc block in `index.ts`.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

MIT
