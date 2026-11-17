# TypeScript hardening

`npm run typecheck` runs the existing whole-project check and a stricter,
dependency-light core check. `npm run typecheck:core` runs only the latter.
The core covers shared types, matching, local and LLM keyword prompt generation,
and injection formatting. It enables `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and dependency declaration checking, with no emit.
It does not claim stricter coverage of Pi SDK integration or filesystem modules.

Negative contracts in `typechecks/core.test-d.ts` verify that unchecked array
access and explicit undefined option overrides are rejected. These contracts
are deliberately outside the normal test compilation. Runtime tests in
`test/typescript-config.test.ts` protect the scope, flags and mandatory script
chain. Existing matching tests cover Unicode boundaries and rolling windows.

## Provenance

The method was recovered locally from `/Users/applesucks/dev/pi-agents`, whose
package is `pi-subagentura`. The relevant work is from November 14, 2026:

- `efaa6eb15630a72ebe0fc3a48003c6a247dd57b6`, 16:05:16 +0200:
  Harden extension execution and TypeScript boundaries (#235).
- `ffd2e5c445eb57e0371d0acda5ecfe9edcd711b7`, 14:03:14 +0200:
  Incremental strict core typechecks, negative contracts and mandatory script
  wiring.
- `74282f7e32ead66f430849dabaf0505d56b6f248`, 14:01:33 +0200:
  Worker JavaScript and RPC checks. Those worker-specific changes are not needed
  here because this extension has no JavaScript worker.

Pi session history under `~/.pi/agent/sessions` was also inspected. The concrete
implementation evidence is the local Git history and its checked-in compiler,
contract and test artifacts. The inspected hardening precedent does not define
ISO, so this work does not assign a meaning to that acronym.

A reusable global Pi skill is installed at
`~/.pi/agent/skills/typescript-hardening/SKILL.md`, using the existing global
skill directory and YAML frontmatter conventions. Its human-readable name is
TypeScript hardening and its skill name is `typescript-hardening`.
