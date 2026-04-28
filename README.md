# Pi Doc Injector

A [Pi](https://pi.dev) extension that automatically injects relevant project documentation into the LLM system prompt by monitoring streaming output for keyword matches.

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
2. Add markdown files with YAML frontmatter:

```md
---
title: "Testing Workflow"
keywords: [test, testing, jest, vitest]
---

# Testing Workflow

Your documentation here...
```

Keywords can also be specified in block format:

```md
---
title: "Testing Workflow"
keywords:
  - test
  - testing
  - jest
  - vitest
---
```

3. Start Pi. The extension scans `docs/` on session start.
4. When the LLM mentions keywords from your docs, the relevant document is injected into the next turn's system prompt.

## Configuration

Create `.pi/doc-injector.json` in your project root to customize behavior:

```json
{
  "docsPath": "./docs",
  "matchThreshold": 2,
  "contextThreshold": 80,
  "recursive": true
}
```

| Option             | Default    | Description                                              |
| ------------------ | ---------- | -------------------------------------------------------- |
| `docsPath`         | `"./docs"` | Path to docs folder (relative to project root)           |
| `matchThreshold`   | `2`        | Minimum keyword matches required to inject a doc         |
| `contextThreshold` | `80`       | Skip injection when context usage exceeds this % (0–100) |
| `recursive`        | `true`     | Scan docs subdirectories recursively                     |

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

## Injection Lifecycle

The extension uses a per-session injection model:

- On `session_start`, the registry is rebuilt from scratch, resetting all `injected` flags.
- Within a session, once a document is injected, it won't be re-injected automatically.
- Use `/doc-inject reset` to manually reset all flags and allow docs to be injected again.
- Use `/doc-inject list` to see which docs have been injected (✅) and which are pending (⬜).

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

## License

MIT
