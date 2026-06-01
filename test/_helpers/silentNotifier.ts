/**
 * No-op Notifier for unit tests that don't care about warning emission.
 *
 * Production code uses `ExtensionNotifier` (which buffers until a real
 * `ctx` is bound and forwards to `ctx.ui.notify()`). Tests that don't
 * assert on warning content can pass this silent implementation instead.
 *
 * Tests that DO want to capture warnings should construct a plain
 * `vi.fn()`-based object directly:
 *
 *   const notifier: Notifier = {
 *       info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn(),
 *   };
 *   await loadConfig(tmpDir, notifier);
 *   expect(notifier.warn).toHaveBeenCalledWith(expect.stringContaining("clamping"));
 */
import type { Notifier } from "../../notifier";

export const silentNotifier: Notifier = {
    info: () => {},
    warn: () => {},
    error: () => {},
    setContext: () => {},
};
