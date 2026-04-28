# pi-doc-injector: Bug Fixes & Enhancements Spec

**Date:** 2026-04-26  
**Status:** Draft  

## Verified Bugs

### BUG-1: message_update buffer replacement is fragile (Low Priority)
- **File:** `index.ts:80`
- **Current:** `textBuffer = extractText(msg.content)` replaces the entire buffer on each `message_update`
- **Risk:** If Pi ever sends incremental deltas instead of full content, early keywords would be lost
- **Fix:** Add a contract comment documenting that `message_update` contains full accumulated content per Pi's API. No code change needed for current behavior.
- **Decision (Q1):** Assume full content + document the contract

### BUG-2: Injected flags never auto-reset (Medium Priority)
- **File:** `index.ts:109` — `entry.injected = true` persists for entire Pi session
- **Impact:** Docs can only be injected once per session unless manually reset via `/doc-inject reset`
- **Actually:** `session_start` already recreates the registry via `initRegistry`, so per-session reset happens. The perceived bug is that within a session, once a doc is injected it stays injected.
- **Decision (Q2):** This is intended behavior — docs should inject once per session. Document clearly in README and `/doc-inject status` output.

### BUG-3: Shallow directory scanning (Medium Priority)
- **File:** `registry.ts:73` — `readdirSync(resolved)` only scans top-level files
- **Impact:** Users with nested doc folders (`docs/api/`, `docs/guides/`) have files silently ignored
- **Fix:** Use `readdirSync({ recursive: true })` and add `recursive` config option (default: `true`)
- **Decision (Q3):** Recursive by default, configurable

### BUG-4: Dual reload paths (Low Priority)
- **Files:** `index.ts:47-51` (event handler), `commands.ts:82-90` (command)
- **Impact:** Both paths call `rebuild()` directly but could diverge if rebuild gains side effects
- **Fix:** Extract shared `reloadRegistry()` helper called by both
- **Decision (Q4):** Extract shared helper

### BUG-5: injected flag mutation on shared references (Medium Priority)
- **File:** `index.ts:109` — `entry.injected = true` on objects from `getEntries()`
- **Verification:** `getEntries()` returns `[...this.entries]` — new array, shared object references. Mutation **does** propagate to `this.entries`. The system works but relies on unintuitive JS semantics.
- **Original claim ("system is broken"):** INCORRECT — verified that mutation propagates correctly
- **Fix:** Add explicit `markInjected(filePaths: string[])` and keep `reset()` on `DocRegistry`. Update callers to use these methods instead of direct mutation. Add JSDoc documenting that `getEntries()` returns shared references.
- **Decision (Q5):** Encapsulate mutation through explicit methods

### BUG-6: notifyInjection inline type (Low Priority)
- **File:** `injector.ts:35` — `ui` parameter typed with inline `{ notify: ... }` instead of Pi's `ExtensionContext['ui']`
- **Fix:** Import and use `ExtensionContext['ui']` or `Pick<ExtensionContext['ui'], 'notify'>`
- **Tracked under:** Q8 (tsconfig strict mode will catch this)

## Enhancements

### ENH-1: Add `tsconfig.json` with `strict: true`
- Enables compile-time type checking
- Will catch the inline type in `injector.ts` and any other type issues
- May require minor fixes to pass strict mode

### ENH-2: Add `contextThreshold` config option
- **File:** `index.ts:103` — hardcoded `usage.percentage > 80`
- **Fix:** Add `contextThreshold` to `DocInjectorConfig` (default: 80), read from `.pi/doc-injector.json`

### ENH-3: Document streaming model in code
- Add comment on `message_update` handler explaining that Pi sends full accumulated content
- Add comment on matching strategy explaining why we match on every update

## Non-Functional Requirements

- **NFR-1:** All mutation of `DocEntry.injected` must go through `DocRegistry` methods
- **NFR-2:** Maintain O(n) scanning for recursive directory traversal (no exponential blowup)
- **NFR-3:** Backward-compatible config — new fields have sensible defaults
- **NFR-4:** All existing tests must continue to pass
- **NFR-5:** New code must have test coverage