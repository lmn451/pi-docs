# Execution TODO

## Phase 1: Async I/O + Types + Config
- [ ] P1.1-P1.3: types.ts (new config fields, interfaces, keywordSource)
- [ ] P1.4-P1.5: config.ts (async load, validation)
- [ ] P1.6-P1.7: registry.ts (async I/O conversion)
- [ ] P1.8: index.ts (await loadConfig)
- [ ] P1.9: test/config.test.ts (async tests)
- [ ] P1.10: test/registry.test.ts (keywordSource mocks)

## Phase 2: Glob + Binary Detection
- [ ] P2.1: package.json (picomatch dep)
- [ ] P2.2: globber.ts (new)
- [ ] P2.3: binary-detect.ts (new)
- [ ] P2.4-P2.7: registry.ts (glob, binary pipeline reorder)
- [ ] P2.8: index.ts (new create() call sites)
- [ ] P2.9: test/registry.test.ts (config object)
- [ ] P2.10: test/globber.test.ts (new)
- [ ] P2.11: test/binary-detect.test.ts (new)

## Phase 3: Multi-Style Frontmatter
- [ ] P3.1-P3.5: registry.ts (4 parser styles)
- [ ] P3.6: test/registry.test.ts (frontmatter tests)

## Phase 4: Keywords + Cache
- [ ] P4.1: cache.ts (new)
- [ ] P4.2: keyword-gen.ts (new)
- [ ] P4.3-P4.8: registry.ts (PromisePool, cache integration)
- [ ] P4.9: index.ts (cache wiring + MAJOR-2 merge)
- [ ] P4.10: test/cache.test.ts (new)
- [ ] P4.11: test/keyword-gen.test.ts (new)

## Phase 5: LLM Keyword Generation
- [ ] P5.1: keyword-llm.ts (new)
- [ ] P5.2-P5.3: commands.ts (deps + /doc-keywords-gen)
- [ ] P5.4: index.ts (inline tool, guard flags, safety unbinds)

## Phase 6: Integration
- [ ] P6.1: matcher.ts (regex edge cases)
- [ ] P6.2: index.ts (final wiring)
- [ ] P6.3-P6.5: test updates + integration tests
- [ ] P6.6: injector.ts (prompt injection sanitization)
- [ ] P6.7: JSDoc pass
- [ ] P6.8: npm test
- [ ] P6.9: manual smoke test
- [ ] P6.10: commands.ts (keywordSource in list)
