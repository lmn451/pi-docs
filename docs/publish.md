---
title: "Publishing Workflow"
keywords: [publish, release, npm, version, tag, semantic versioning]
---

# Publishing Workflow

## Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** — incompatible API changes
- **MINOR** — backwards-compatible functionality additions
- **PATCH** — backwards-compatible bug fixes

## Publishing a New Version

1. Bump version in `package.json`:
   ```bash
   npm version patch  # 0.1.1 → 0.1.2
   npm version minor  # 0.1.1 → 0.2.0
   npm version major  # 0.1.1 → 1.0.0
   ```

2. Push the tag to trigger the publish workflow:
   ```bash
   git push origin master --tags
   ```

3. GitHub Actions will automatically run tests and publish to npm.

## Manual Publish

```bash
npm publish
```

## Setup

Add your npm token as a GitHub secret:
- Go to repository Settings → Secrets and variables → Actions
- Add a new secret named `NPM_TOKEN` with your npm access token
