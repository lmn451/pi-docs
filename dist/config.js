/**
 * Configuration loader for the Doc Injector extension.
 * Reads from `.pi/doc-injector.json` with fallback to defaults.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./types";
/**
 * Clamp an integer value to [min, max] range.
 * Warns and clamps if out of range. Returns the default if not a number.
 */
function clampInt(value, defaultVal, min, max, fieldName) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return defaultVal;
    }
    const intVal = Math.trunc(value);
    if (intVal < min || intVal > max) {
        const clamped = Math.max(min, Math.min(max, intVal));
        console.warn(`[doc-injector] ${fieldName} must be ${min}-${max}, got ${intVal}. Clamping to ${clamped}.`);
        return clamped;
    }
    return intVal;
}
/**
 * Validate a glob pattern array.
 * Rejects non-array or entries that aren't strings. Returns default on error.
 */
function validateGlobArray(value, defaultVal) {
    if (!Array.isArray(value)) {
        return [...defaultVal];
    }
    const result = [];
    for (const item of value) {
        if (typeof item === "string") {
            result.push(item);
        }
        else {
            console.warn(`[doc-injector] Non-string entry in glob array ignored: ${String(item)}`);
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
export async function loadConfig(cwd) {
    const configPath = join(cwd, ".pi", "doc-injector.json");
    try {
        const raw = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            docsPath: parsed.docsPath ?? DEFAULT_CONFIG.docsPath,
            matchThreshold: clampInt(parsed.matchThreshold, DEFAULT_CONFIG.matchThreshold, 1, Infinity, "matchThreshold"),
            contextThreshold: clampInt(parsed.contextThreshold, DEFAULT_CONFIG.contextThreshold, 0, 100, "contextThreshold"),
            recursive: parsed.recursive ?? DEFAULT_CONFIG.recursive,
            include: validateGlobArray(parsed.include, DEFAULT_CONFIG.include),
            exclude: validateGlobArray(parsed.exclude, DEFAULT_CONFIG.exclude),
            maxFileSize: clampInt(parsed.maxFileSize, DEFAULT_CONFIG.maxFileSize, 1024, 10 * 1024 * 1024, "maxFileSize"),
            autoKeywords: parsed.autoKeywords ?? DEFAULT_CONFIG.autoKeywords,
            llmKeywords: parsed.llmKeywords ?? DEFAULT_CONFIG.llmKeywords,
            maxConcurrent: clampInt(parsed.maxConcurrent, DEFAULT_CONFIG.maxConcurrent, 1, 100, "maxConcurrent"),
            llmBatchSize: clampInt(parsed.llmBatchSize, DEFAULT_CONFIG.llmBatchSize, 1, 100, "llmBatchSize"),
        };
    }
    catch (err) {
        if (err.code !== "ENOENT") {
            console.warn(`[doc-injector] Failed to parse config at ${configPath}:`, err instanceof Error ? err.message : String(err));
        }
        return { ...DEFAULT_CONFIG };
    }
}
//# sourceMappingURL=config.js.map