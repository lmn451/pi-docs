# Critic Review — Plan Draft v2

> Reviewing: `.pi/ralplan/drafts/plan_draft.md` (Planner Draft 2)

---

## Critic Analysis

### Issues Found

#### 1. Steer Message Injection is the WRONG Mechanism (Critical)

The plan uses `pi.sendMessage()` with `deliverAs: "steer"` to inject docs. But this creates a **new message** in the conversation history. The problem: after the assistant finishes its response, a steer message is delivered, which triggers a NEW LLM turn. This means:

1. User asks: "How do I write tests?"
2. Assistant responds with an answer
3. Extension detects "test" keywords, injects test-md.md as a steer message
4. LLM sees the steer message and generates ANOTHER response

This is **disruptive** — the user gets a second response they didn't ask for. The user wanted docs injected into the context for the CURRENT or NEXT user turn, not to trigger an unsolicited extra response.

**Recommended fix:** Use `before_agent_start` event to inject docs as a system prompt modification, NOT as a steer message. The flow should be:
- `message_update`/`message_end` detects keywords
- Store matched docs in state
- On the NEXT `before_agent_start`, inject matched docs into the system prompt
- This way, docs are available for the next user turn without triggering extra responses

Alternatively: inject as a `user`-role message via `pi.sendUserMessage()` with `deliverAs: "nextTurn"` — this queues it for the next user prompt without triggering an immediate response.

#### 2. Streaming Buffer Implementation is Under-Specified (Medium)

The plan says "accumulate text from `message_update` events" but doesn't specify:
- How to distinguish between the current turn's messages and previous messages
- How to handle the `message_update` event's `event.message` which may contain the FULL message content (not just new tokens)
- Whether the buffer should be replaced (not appended) on each update, since `message_update` likely contains the cumulative message

**Recommended fix:** `message_update` contains the FULL current message content, not incremental tokens. So the buffer should be REPLACED on each update, not appended. This is a fundamental implementation detail that changes the design.

#### 3. No Deduplication of Matched Docs (Medium)

If the same keywords appear across multiple `message_update` events during streaming, the same doc could be matched multiple times. The plan doesn't clarify whether matches are accumulated per-message or per-streaming-session.

**Recommended fix:** Track matched docs per `message_end` cycle using a Set. Only inject once per message completion.

#### 4. Missing: Configurable Docs Path (Medium)

The spec (FR-6) requires a configurable docs path, but the plan hardcodes `./docs/`. There's no mechanism to read from `settings.json` or environment variables.

**Recommended fix:** Read docs path from a config file (e.g., `.pi/doc-injector.json`) or from `settings.json` extensions config. Default to `./docs/`.

#### 5. Task 8 Testing is Underspecified (Low)

"Use simple assert-based tests" is vague. How are tests run? What test framework? How does the test harness mock the pi ExtensionAPI?

**Recommended fix:** Use Node.js built-in `assert` module. Create a test runner that can be invoked with `node`. Mock the ExtensionAPI with simple stubs.

---

## Verdict: REJECTED — Requires revision

The critical issue (#1) about steer message injection fundamentally changes the event flow. The plan must be revised to use `before_agent_start` for injection instead of `sendMessage(steer)`.

The buffer implementation detail (#2) also needs clarification since it affects the `message_update` handler logic.

---

## Suggested Revision Summary

1. **Change injection timing:** Store matches from `message_end`, inject via `before_agent_start` on the NEXT turn
2. **Fix buffer logic:** `message_update` replaces buffer (not appends) since it contains full message
3. **Add deduplication:** Track matched docs per message completion
4. **Add config mechanism:** Support configurable docs path via JSON config file
5. **Specify test approach:** Use Node.js `assert` module with mocked ExtensionAPI
