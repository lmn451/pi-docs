# Pi Doc Injector

A [Pi](https://pi.dev) extension that automatically injects relevant project documentation into the LLM system prompt by monitoring streaming output for keyword matches.

## Installation

### Via npm (recommended)

```bash
pi install npm:pi-doc-injector
```

### Via git

```bash
pi install git:github.com/yourname/pi-doc-injector
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

Create `.pi/doc-injector.json` to customize behavior:

```json
{
  "docsPath": "./docs",
  "matchThreshold": 2
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `docsPath` | `./docs` | Path to your documentation folder |
| `matchThreshold` | `2` | Minimum keyword matches before injecting |

### Keyword Matching

Matching is case-insensitive and respects word boundaries by default. Once a document is injected, it won't re-match until you run `/doc-inject reset`.

Injection is also skipped if the current context usage exceeds 80% of the token budget.

## Commands

| Command | Description |
|---------|-------------|
| `/doc-inject on` | Enable auto-injection |
| `/doc-inject off` | Disable auto-injection |
| `/doc-inject toggle` | Toggle on/off |
| `/doc-inject status` | Show injector status, doc count, keyword count |
| `/doc-inject list` | List all registered documents |
| `/doc-inject reset` | Reset injection state (allows re-matching docs) |
| `/doc-reload` | Re-scan docs folder |

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

## License

MIT
