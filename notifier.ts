/**
 * Notifier — thin wrapper around Pi's `ctx.ui.notify()` that buffers
 * messages until a context is available.
 *
 * ## Why a buffer?
 *
 * Several warnings fire at startup (during `loadConfig` and `initRegistry`),
 * before any `ExtensionContext` exists — extensions are constructed first,
 * events fire later. The `Notifier` interface accepts messages at any time:
 *
 * - If a context has been set, messages are forwarded to `ctx.ui.notify()`.
 * - If not, messages are buffered in memory and flushed on the next
 *   `setContext()` call (typically from `session_start`).
 *
 * Production code uses `ExtensionNotifier`. Tests inject a plain object
 * satisfying the `Notifier` interface (or a `vi.fn()` spy) — no real
 * extension context is needed.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type NotifierLevel = "info" | "warning" | "error";

export interface Notifier {
    /** Show an informational message. */
    info(message: string): void;
    /** Show a warning. */
    warn(message: string): void;
    /** Show an error. */
    error(message: string): void;
    /**
     * Bind a context. Flushes any buffered messages via `ctx.ui.notify()`
     * in arrival order. Idempotent: re-calling replaces the context and
     * clears the buffer (already-flushed messages are not re-sent).
     */
    setContext(ctx: ExtensionContext): void;
}

/** Production notifier. Buffers until a context is bound. */
export class ExtensionNotifier implements Notifier {
    private ctx: ExtensionContext | null = null;
    private buffer: Array<{ level: NotifierLevel; message: string }> = [];

    setContext(ctx: ExtensionContext): void {
        this.ctx = ctx;
        const pending = this.buffer;
        this.buffer = [];
        for (const { level, message } of pending) {
            ctx.ui.notify(message, level);
        }
    }

    info(message: string): void {
        this.emit("info", message);
    }

    warn(message: string): void {
        this.emit("warning", message);
    }

    error(message: string): void {
        this.emit("error", message);
    }

    private emit(level: NotifierLevel, message: string): void {
        if (this.ctx) {
            this.ctx.ui.notify(message, level);
        } else {
            this.buffer.push({ level, message });
        }
    }
}
