/**
 * Tests for the Notifier — the buffer-and-flush wrapper around
 * `ctx.ui.notify()`.
 *
 * The Notifier exists because startup-time warnings (loadConfig, loadCache,
 * DocRegistry.create) fire BEFORE any `ExtensionContext` is available. The
 * Notifier buffers them and flushes in arrival order on the next
 * `setContext()` call.
 */
import { describe, expect, test, vi } from "vitest";
import { ExtensionNotifier, type Notifier } from "../notifier";

function makeCtx() {
  return {
    ui: { notify: vi.fn() },
  } as unknown as Parameters<Notifier["setContext"]>[0];
}

describe("ExtensionNotifier", () => {
  test("buffers messages before setContext is called", () => {
    const notifier = new ExtensionNotifier();
    notifier.warn("first");
    notifier.error("second");
    notifier.info("third");

    const ctx = makeCtx();
    notifier.setContext(ctx);

    const calls = (ctx.ui.notify as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls).toEqual([
      ["first", "warning"],
      ["second", "error"],
      ["third", "info"],
    ]);
  });

  test("forwards messages directly once a context is bound", () => {
    const notifier = new ExtensionNotifier();
    notifier.setContext(makeCtx());

    const ctx2 = makeCtx();
    // Replace the bound context with a new one (setContext is idempotent)
    notifier.setContext(ctx2);

    notifier.info("after-bind-1");
    notifier.warn("after-bind-2");

    // The second ctx should receive the post-bind messages.
    const ctx2Calls = (
      ctx2.ui.notify as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(ctx2Calls).toEqual([
      ["after-bind-1", "info"],
      ["after-bind-2", "warning"],
    ]);
  });

  test("does not re-flush already-flushed messages on a second setContext", () => {
    const notifier = new ExtensionNotifier();
    notifier.warn("once");

    const ctx1 = makeCtx();
    notifier.setContext(ctx1);
    expect(
      (ctx1.ui.notify as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .length,
    ).toBe(1);

    // A second setContext (e.g. session reload) should NOT re-send the
    // already-flushed message.
    const ctx2 = makeCtx();
    notifier.setContext(ctx2);
    expect(
      (ctx2.ui.notify as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .length,
    ).toBe(0);
  });

  test("preserves arrival order across multiple levels", () => {
    const notifier = new ExtensionNotifier();
    notifier.info("a");
    notifier.warn("b");
    notifier.error("c");
    notifier.info("d");

    const ctx = makeCtx();
    notifier.setContext(ctx);

    const calls = (ctx.ui.notify as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["a", "b", "c", "d"]);
    expect(calls.map((c) => c[1])).toEqual([
      "info",
      "warning",
      "error",
      "info",
    ]);
  });
});
