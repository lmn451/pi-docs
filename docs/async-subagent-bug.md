# Doc-Injector & Async Subagents Bug Analysis

## Overview

The doc-injector extension causes spinner hangs when used alongside async subagent workflows (e.g., `subagent_isolated`, `subagent_with_context` with `async: true`).

## Root Cause

### The Flow

1. Parent spawns async subagents with `async: true, notifyOnComplete: "inject"`
2. Parent streams output (e.g., "I've launched 5 agents...")
3. Doc-injector's `message_update` fires, detects keyword match
4. Doc-injector calls `ctx.abort()` to abort current turn
5. `agent_end` fires → extension injects `"continue"` via `setTimeout()`
6. Parent receives `"continue"` → immediately calls `get_subagent_result x5`
7. Subagents still running → results not available → **spinner stuck**

### Why This Happens

The current doc-injector design assumes it can abort the current turn and restart immediately with injected docs. This works for simple single-turn workflows but breaks async subagent workflows because:

1. **The injected `"continue"` disrupts the expected flow** - parent should wait for `notifyOnComplete: "inject"` messages, not immediately poll for results
2. **`get_subagent_result` blocks** - when called before subagents finish, it hangs the parent thread
3. **The abort signal is shared** - in some subagent implementations (e.g., the `subagent` tool in pi-subagentura), async subagents explicitly don't inherit the parent abort signal. But the injected `"continue"` still breaks the flow

### Key Code Path (doc-injector/index.ts)

```typescript
// message_update handler - triggers abort on keyword match
pi.on("message_update", async (event, ctx) => {
  if (hasNew && !ctx.isIdle() && !abortingForInjection) {
    abortingForInjection = true;
    ctx.abort(); // ← PROBLEM: aborts current turn
  }
});

// agent_end handler - injects "continue" after abort
pi.on("agent_end", async (event, ctx) => {
  if (abortingForInjection) {
    abortingForInjection = false;
    setTimeout(() => {
      pi.sendUserMessage("continue"); // ← PROBLEM: disrupts async flow
    }, 0);
  }
});
```

## Subagentura System Context

### How Async Subagents Work

The subagentura system (`/Users/applesucks/dev/pi-agents/subagent.ts`) spawns async subagents that:

1. Run in the same process (not subprocess)
2. Have independent session/context
3. Signal via `notifyOnComplete: "inject"` - results injected as user messages when complete
4. Use `get_subagent_result` to poll/block for results

### Key Line (subagent.ts line 541, 744)

```typescript
signal: undefined, // async: don't inherit parent signal (would abort subagent when tool returns)
```

### Option A: Remove ctx.abort() Entirely (Recommended)

**Change:** Never call `ctx.abort()` in `message_update`. Just record matches and inject on next turn.

**Pros:**

- ✅ Simplest fix
- ✅ Works with ANY async workflow automatically
- ✅ No special-casing for subagents

**Cons:**

- ❌ Loses "immediate injection during streaming" optimization
- ❌ Docs injected on next turn instead of immediately

**Implementation:**

```typescript
pi.on("message_update", async (event, ctx) => {
  if (keywordGenInFlight) return;
  if (!enabled || !registry) return;
  if (msg.role !== "assistant") return;

  const content = (msg as unknown as { content: unknown }).content;
  textBuffer = extractText(content);
  if (!textBuffer) return;

  const matcher = buildMatcher();
  if (!matcher) return;

  const results = matcher.match(textBuffer);
  for (const result of results) {
    if (!pendingMatches.has(result.entry.filePath)) {
      hasNew = true; // Just record - don't abort
    }
    pendingMatches.set(result.entry.filePath, result.matchedKeywords);
  }

  // REMOVE: ctx.abort() entirely
  // Just let the turn complete naturally
});
```

### Option B: Detect Async Subagents Before Aborting

**Change:** Check if assistant just spawned async subagents, skip abort if so.

**Pros:**

- ✅ Preserves immediate injection behavior
- ✅ Subagents continue running

**Cons:**

- ❌ Fragile - depends on detecting specific tool call patterns
- ❌ Doesn't scale to other async workflows

### Option C: Only Inject on User Input

**Change:** Only trigger immediate injection on `input` event (user messages), not on assistant streaming.

**Pros:**

- ✅ Clean separation of concerns
- ✅ User intent gets immediate response

**Cons:**

- ❌ Loses streaming injection optimization
- ❌ Still may not handle all async edge cases

## Recommendation

**Use Option A:** Remove `ctx.abort()` entirely.

The streaming injection optimization is not worth the complexity and the risk of breaking async workflows. Most keyword matches from assistant streaming are not time-critical - they can wait for the next turn.

## Additional Notes

### The notifyOnComplete:"inject" Flow

1. Parent spawns `async: true, notifyOnComplete: "inject"`
2. Parent continues immediately (doesn't wait)
3. Each subagent runs independently
4. When subagent completes, result is injected as user message via `pi.sendUserMessage()`
5. Parent receives the injected result and continues naturally

This flow is designed to work without any intervention from the parent. Breaking it with `ctx.abort()` + `"continue"` defeats the purpose.

### Session Context

Each subagent runs in its **own session** with its own doc-injector instance. Doc injection in subagent sessions is fine - they inject their own docs into their own context. The problem is only in the **parent session**.

## References

- doc-injector: `/Users/applesucks/dev/pi-docs/index.ts`
- subagentura: `/Users/applesucks/dev/pi-agents/subagent.ts`
- subagentura helpers: `/Users/applesucks/dev/pi-agents/helpers.ts`

## Web Research Summary

### Official Documentation

From `pi.dev/docs/latest/extensions`, the key lifecycle events are:

- `before_agent_start` - Fires after user submits prompt, **before** agent loop. Can inject a message and/or modify system prompt.
- `agent_start` / `agent_end` - Fires once per user prompt
- `message_update` - Fires during streaming output
- `input` - Fires on user input

**Important note from docs:** "For critical events (before_agent_start, context, tool_call), if all handlers fail, the system continues with default behavior."

### Key Extension API Points

1. **`ctx.abort()`** - "Request a graceful shutdown of pi. Interactive mode: Deferred until the agent becomes idle (after processing all queued steering and follow-up messages)."
2. **`ctx.signal`** - Available for extensions to forward cancellation into nested model calls, fetch(), and other abort-aware work.
3. **`before_agent_start`** - The recommended injection point for context, as it runs before the agent loop starts.

### Related GitHub Issues

- [Issue #624](https://github.com/earendil-works/pi/issues/624): "before_agent_start event does not properly inject message" - indicates there have been historical issues with injection timing
- [Issue #2660](https://github.com/earendil-works/pi/issues/2660): "Expose abort signal on ExtensionContext" - led to `ctx.signal` being added

### Subagent Extensions Found

1. **tintinweb/pi-subagents** (`pi.dev/packages/pi-subagents`)
   - Claude Code-style autonomous subagents
   - Spawns agents in isolated sessions
   - Run in foreground or background
   - Similar to subagentura

2. **nicobailon/pi-subagents** (GitHub)
   - Async subagent delegation with truncation, artifacts, session sharing

### Conclusion from Web Research

No documented solutions exist for the specific conflict between streaming injection (via `ctx.abort()`) and async subagent workflows. The recommended approach based on official docs is:

1. Use `before_agent_start` for context injection (runs before agent loop)
2. Avoid `ctx.abort()` during streaming - it disrupts any workflow that expects continuous streaming
3. The `input` event is the cleanest injection point for user-driven context since it represents new user intent
