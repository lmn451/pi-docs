---
name: doc-authoring
description: Create, maintain, and validate project docs folders for pi-doc-injector. Use when setting up docs, writing reference documents, checking filename triggers, or diagnosing missing document injection.
---

# Documentation folder creation and validation

Create useful project documentation and verify that pi-doc-injector can discover
and match it. Default to simple filename matching, not keyword frontmatter.

## 1. Inspect before writing

- Confirm the project root, project instructions, existing docs, and git status.
  Preserve unrelated work. Do not overwrite, rename, or delete existing docs
  merely to make them fit a template.
- Read `.pi/doc-injector.json` if it exists. Resolve `docsPath` relative to the
  project root, defaulting to `./docs`; `mode` defaults to `simple`.
- Check configuration types. `docsPath` must be a nonempty string, `recursive`
  a boolean, and `include`/`exclude` arrays of strings. Report malformed config
  rather than quietly validating a different folder. An explicit empty exclude
  array is valid. Inspect `maxFileSize` and actual include/exclude patterns.
- Inspect source, tests, and existing docs for factual content. Do not invent
  commands, APIs, architecture, or project-specific behavior. Ask one focused
  question only if the intended topic cannot be established from the request
  and repository.

## 2. Create the folder and focused documents

Create the configured folder if absent. Do not change project configuration
unless needed and requested; no config file is required for the default setup.
Check for a symlinked folder or symlinked ancestors before writing outside the
project. Do not follow unexpected links or copy external/private content.

For **simple mode**:

- Put lowercase `.md` files directly inside the configured folder. Nested files
  and `.txt` files are not indexed in this mode, even with `recursive: true`.
- Choose a meaningful filename stem that people actually mention. `auth.md`
  matches the complete word `auth`, case-insensitively, not `authentication`.
  `api-auth.md` matches `api-auth`, not `auth`; filenames are not split into
  separate trigger words. Kebab-case is a convention, not a runtime requirement.
- Avoid broad names that cause accidental injection and stems that differ only
  in case. Never silently rename existing documents to change their triggers.
- Frontmatter is optional and does not supply triggers in simple mode. Use a
  clear H1 title, concise purpose, verified instructions, and relevant examples.
- Keep each doc focused and below the configured `maxFileSize` in UTF-8 bytes
  (default 102400 bytes). Do not pad a document to fill a generic template.

Example, `docs/auth.md`:

```md
# Authentication

## Purpose

Explain the project's authentication flow and when to consult this reference.

## Instructions

Document verified implementation details, commands, and expected results here.
```

For **keyword mode**, only when already configured or explicitly requested:

- Nested docs require `recursive: true`. `.md` and `.txt` are included by the
  default glob patterns, but actual include/exclude settings still apply.
- Prefer explicit frontmatter for stable triggers. Keywords are distinct terms;
  repeated occurrences or duplicate keywords do not satisfy `matchThreshold`.
- Choose 3–10 specific terms. Avoid generic filler and account for the configured
  threshold (default 2 distinct terms). Frontmatter is optional when heuristic,
  cached, or LLM keyword generation is used.

```md
---
title: Authentication
keywords: [auth, login, sign in]
---

# Authentication

Verified project reference content.
```

Never put credentials, access tokens, private conversations, or unrelated data
in injectable documentation. Inspect examples for secrets as well as prose.

## 3. Validate the folder

Produce a per-file inventory with path, UTF-8 byte size, matching mode, expected
trigger(s), and eligibility or the specific reason it will not be indexed.
Check the following without modifying files simply to silence warnings:

1. The configured folder exists and contains intended reference documents.
2. Every intended document is a regular file, not a symlink. Linked documents
   are rejected by the extension. Identify unexpected links without following
   them and never claim linked content was validated.
3. Simple-mode docs are top-level lowercase-extension `.md` files with nonempty
   stems. Identify nested docs, `.txt`, uppercase `.MD`, and empty-stem `.md`
   files as ineligible, not silently accepted.
4. Actual include/exclude patterns permit each intended file. If project-local
   extension code/tools are available, reuse its config loader, registry and
   matcher rather than inventing a second glob or boundary implementation.
   Do not install dependencies just to simulate the extension.
5. Files fit the configured byte limit, have useful content, and contain no
   obvious secrets. Flag case-insensitive duplicate stems and overly generic
   triggers as authoring warnings, not fictional registry rejection rules.
6. Documented commands, relative links, and code references exist or are marked
   explicitly as unverified. Do not claim external links were checked without
   checking them. Avoid network access unless relevant and authorized.
7. For keyword mode, validate frontmatter parsing and distinct-keyword threshold
   with the actual extension when available. `not_keywords` is not `keywords`.

Distinguish static eligibility checks from successful runtime registration and
matching. If Pi is not available, report the runtime check as pending, not passed.

## 4. Verify inside Pi

- Run `/doc-reload`, then `/doc-inject status` and `/doc-inject list`. Confirm the
  expected paths and keyword sources: `filename` for simple mode, or the actual
  frontmatter/cache/heuristic/LLM source in keyword mode.
- If configuration itself changed, reload the extension/session first so the
  updated configuration is loaded. `/doc-reload` rescans docs; do not assume it
  reloads configuration.
- With permission to add a test message to the session, use one representative
  filename stem in simple mode, or enough distinct keywords in keyword mode.
  Check `/doc-inject history` for the saved injection path and recorded reason.
  A history entry proves saved injection, not that the model read the document.
- Account for already-injected marks and the context-usage guard. Do not reset
  the user's injection state automatically. Use `/doc-inject reset` only when
  explicitly testing reinjection with the user's agreement.
- User matches inject before the response. Simple-mode assistant matches are
  scanned at the completed turn boundary and may continue the same run once;
  keyword assistant matches wait for the next run. Do not test by aborting a
  response or sending synthetic `continue` messages.

## 5. Finish

Format only changed Markdown/config files with existing project tools. Run
relevant existing checks when available; do not assume arbitrary projects have
npm scripts or install new tooling unnecessarily. Review the diff and commit
only owned changes when appropriate. Report files created/updated, validation
results, remaining warnings, and the exact Pi steps still pending.

This skill prepares documentation and checks compatibility. It must not rewrite
the system prompt, prepend docs to conversation history, or change extension
matching/injection behavior as a side effect.
