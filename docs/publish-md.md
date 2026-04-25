---
title: "Publishing Workflow"
keywords: [publish, release, deploy, version, npm, changelog, tag, semantic versioning, production, staging]
---

# Publishing Workflow

## Overview

This document covers the process for publishing releases and deploying to production.

## Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** — incompatible API changes
- **MINOR** — backwards-compatible functionality additions
- **PATCH** — backwards-compatible bug fixes

## Release Process

1. Update `CHANGELOG.md` with all changes since last release
2. Bump version in `package.json`
3. Create a git tag: `git tag -a v1.2.3 -m "Release v1.2.3"`
4. Push tags: `git push origin --tags`
5. CI will automatically build and publish

## Publishing to npm

```bash
# Dry run first
npm publish --dry-run

# Actual publish
npm publish
```

## Deployment

### Staging
- Deployed automatically on merge to `main`
- URL: staging.example.com
- Used for QA and integration testing

### Production
- Deployed from release tags only
- URL: app.example.com
- Requires manual approval in CI pipeline

## Rollback Procedure

If a release causes issues:
1. Identify the problematic version
2. Revert the git tag
3. Re-deploy the previous version
4. Post-mortem within 48 hours
