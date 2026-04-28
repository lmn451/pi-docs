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

### 1. Bump the version

```bash
npm version patch  # 0.1.1 → 0.1.2
npm version minor  # 0.1.1 → 0.2.0
npm version major  # 0.1.1 → 1.0.0
```

This updates `package.json` and creates a local tag.

### 2. Push the tag to trigger the workflow

```bash
git push origin v0.1.1
```

Or push all tags:

```bash
git push origin --tags
```

**Important:** The publish workflow triggers on tags pushed to remote, not just locally created tags. The tag must match the pattern `v*` (e.g., `v0.1.1`, `v0.2.0`).

### 3. GitHub Actions Publish workflow

Once the tag is pushed, the `Publish` workflow automatically:
- Runs tests
- Publishes to npm registry

Monitor the workflow at: `https://github.com/lmn451/pi-docs/actions`

## Verify the Publish

Check if the package was published:

```bash
npm view pi-doc-injector
```

## Manual Publish

If needed, you can publish manually:

```bash
npm publish
```

## Setup

Ensure your npm token is configured as a GitHub secret:
- Go to repository Settings → Secrets and variables → Actions
- Add a new secret named `NPM_TOKEN` with your npm access token

## Troubleshooting

**Workflow didn't run?**
- Verify the tag exists remotely: `git ls-remote origin refs/tags/v0.1.1`
- Check that the tag matches the pattern `v*`
- Check GitHub Actions runs at: `https://github.com/lmn451/pi-docs/actions`

**npm publish failed?**
- Ensure `NPM_TOKEN` secret is set
- Verify the version hasn't already been published
