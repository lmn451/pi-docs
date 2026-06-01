/**
 * Configuration loader for the Doc Injector extension.
 * Reads from `.pi/doc-injector.json` with fallback to defaults.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, type DocInjectorConfig } from "./types";
import type { Notifier } from "./notifier";

/**
 * Clamp an integer value to [min, max] range.
 * Warns via the `notifier` and clamps if out of range. Returns the default
 * if not a number.
 */
function clampInt(
    value: unknown,
    defaultVal: number,
    min: number,
    max: number,
    fieldName: string,
    notifier: Notifier,
): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return defaultVal;
    }
    const intVal = Math.trunc(value);
    if (intVal < min || intVal > max) {
        const clamped = Math.max(min, Math.min(max, intVal));
        notifier.warn(`[doc-injector] ${fieldName} must be ${min}-${max}, got ${intVal}. Clamping to ${clamped}.`);
        return clamped;
    }
    return intVal;
}

/**
/**
 * Validate a glob pattern array.
 * Rejects non-array or entries that aren't strings. Returns default on error.
 * Warns via the `notifier` for non-string entries.
 */
function validateGlobArray(
    value: unknown,
    defaultVal: string[],
    notifier: Notifier,
): string[] {
    if (!Array.isArray(value)) {
        return [...defaultVal];
    }
    const result: string[] = [];
    for (const item of value) {
        if (typeof item === "string") {
            result.push(item);
        } else {
            notifier.warn(`[doc-injector] Non-string entry in glob array ignored: ${String(item)}`);
        }
    }
    return result.length > 0 ? result : [...defaultVal];
}

/**
 * Load config from `.pi/doc-injector.json` relative to the given cwd.
 * Now async — uses readFile from fs/promises.
 * Validates and clamps all numeric fields. Falls back to DEFAULT_CONFIG
 * if file doesn't exist or is invalid.
 */
/**
 * Load config from `.pi/doc-injector.json` relative to the given cwd.
 * Async — uses readFile from fs/promises. Validates and clamps all numeric
 * fields. Falls back to DEFAULT_CONFIG if the file doesn't exist or is
 * invalid. Warnings (clamping, invalid entries) go through the `notifier`.
 */
export async function loadConfig(cwd: string, notifier: Notifier): Promise<DocInjectorConfig> {
    const configPath = join(cwd, ".pi", "doc-injector.json");

    try {
        const raw = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<DocInjectorConfig>;

        return {
            docsPath: parsed.docsPath ?? DEFAULT_CONFIG.docsPath,
            matchThreshold: clampInt(parsed.matchThreshold, DEFAULT_CONFIG.matchThreshold, 1, Infinity, "matchThreshold", notifier),
            contextThreshold: clampInt(parsed.contextThreshold, DEFAULT_CONFIG.contextThreshold, 0, 100, "contextThreshold", notifier),
            recursive: parsed.recursive ?? DEFAULT_CONFIG.recursive,
            include: validateGlobArray(parsed.include, DEFAULT_CONFIG.include, notifier),
            exclude: validateGlobArray(parsed.exclude, DEFAULT_CONFIG.exclude, notifier),
            maxFileSize: clampInt(parsed.maxFileSize, DEFAULT_CONFIG.maxFileSize, 1024, 10 * 1024 * 1024, "maxFileSize", notifier),
            autoKeywords: parsed.autoKeywords ?? DEFAULT_CONFIG.autoKeywords,
            llmKeywords: parsed.llmKeywords ?? DEFAULT_CONFIG.llmKeywords,
            maxConcurrent: clampInt(parsed.maxConcurrent, DEFAULT_CONFIG.maxConcurrent, 1, 100, "maxConcurrent", notifier),
            llmBatchSize: clampInt(parsed.llmBatchSize, DEFAULT_CONFIG.llmBatchSize, 1, 100, "llmBatchSize", notifier),
        };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            const detail = err instanceof Error ? err.message : String(err);
            notifier.warn(`[doc-injector] Failed to parse config at ${configPath}: ${detail}`);
        }
        return { ...DEFAULT_CONFIG };
    }
}
