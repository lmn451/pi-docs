# Publishing to npm

## Automated Publish via GitHub Actions

This extension uses GitHub Actions to automatically publish to npm when a version tag is pushed.

### Setup

1. Add your npm token as a GitHub secret:
   - Go to your repository Settings → Secrets and variables → Actions
   - Add a new secret named `NPM_TOKEN` with your npm access token

### Publishing a New Version

1. Bump the version in `package.json`:
   ```bash
   # For patch releases (0.1.1 → 0.1.2)
   npm version patch

   # For minor releases (0.1.1 → 0.2.0)
   npm version minor

   # For major releases (0.1.1 → 1.0.0)
   npm version major
   ```

2. Push the tag to trigger the publish workflow:
   ```bash
   git push origin --tags
   ```

3. GitHub Actions will automatically:
   - Run tests
   - Publish to npm

### Manual Publish

If needed, you can also publish manually:
```bash
npm publish
```

## Version Tags

The publish workflow triggers on tags matching `v*` (e.g., `v0.1.1`, `v0.2.0`).
