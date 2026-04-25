---
title: "Testing Workflow"
keywords: [test, testing, unit test, integration test, tdd, jest, vitest, assert, mock, stub]
---

# Testing Workflow

## Overview

This document covers the testing workflow for this project. All new features must include tests.

## Testing Principles

1. **Test-driven development** — write tests before implementation when possible
2. **Unit tests** for pure functions and isolated logic
3. **Integration tests** for interactions between modules
4. **E2E tests** for critical user flows

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Writing Tests

- Place test files next to source files with `.test.ts` extension
- Use descriptive test names that explain the expected behavior
- One assertion per test when possible
- Use `describe` blocks to group related tests

## Test Categories

### Unit Tests
- Test individual functions in isolation
- Mock external dependencies
- Fast execution (< 100ms per test)

### Integration Tests
- Test module interactions
- May use real dependencies
- Slower than unit tests

### End-to-End Tests
- Test complete user workflows
- Run against a staging environment
- Slowest but most valuable

## Code Coverage Target

Maintain at least 80% code coverage for all new code.
