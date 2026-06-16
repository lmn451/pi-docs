---
title: "Development Workflow"
keywords:
  [
    workflow,
    development,
    coding,
    git,
    branch,
    commit,
    pull request,
    review,
    ci,
    cd,
    pipeline,
  ]
---

# Development Workflow

## Overview

This document describes the standard development workflow for this project.

## Git Workflow

1. Create a feature branch from `main`
2. Make atomic commits with conventional commit messages
3. Push and create a pull request
4. Request review from at least one team member
5. Merge after approval

## Branch Naming

- `feat/short-description` — new features
- `fix/short-description` — bug fixes
- `refactor/short-description` — code refactoring
- `docs/short-description` — documentation changes
- `test/short-description` — test additions

## Commit Messages

Follow Conventional Commits:

```
type(scope): description

feat(auth): add OAuth2 login support
fix(api): handle null response gracefully
docs(readme): update installation steps
```

## Code Review Guidelines

- Review within 24 hours of PR creation
- Focus on correctness, readability, and test coverage
- Approve only when all CI checks pass
- Leave constructive feedback with specific suggestions

## CI/CD Pipeline

The pipeline runs on every push:

1. Lint check
2. Type check
3. Unit tests
4. Integration tests
5. Build
