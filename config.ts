/**
 * Configuration loader for the Doc Injector extension.
 * Reads from `.pi/doc-injector.json` with fallback to defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type DocInjectorConfig } from "./types";

/**
 * Load config from `.pi/doc-injector.json` relative to the given cwd.
 * Falls back to DEFAULT_CONFIG if file doesn't exist or is invalid.
 */
export function loadConfig(cwd: string): DocInjectorConfig {
  const configPath = join(cwd, ".pi", "doc-injector.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DocInjectorConfig>;

    // Clamp contextThreshold to 0-100 range
    let contextThreshold = parsed.contextThreshold ?? DEFAULT_CONFIG.contextThreshold;
    if (typeof contextThreshold === "number" && (contextThreshold < 0 || contextThreshold > 100)) {
      console.warn(`[doc-injector] contextThreshold must be 0-100, got ${contextThreshold}. Clamping.`);
      contextThreshold = Math.max(0, Math.min(100, contextThreshold));
    }

    // Clamp matchThreshold to positive integers
    let matchThreshold = parsed.matchThreshold ?? DEFAULT_CONFIG.matchThreshold;
    if (typeof matchThreshold === "number" && matchThreshold < 1) {
      console.warn(`[doc-injector] matchThreshold must be >= 1, got ${matchThreshold}. Using 1.`);
      matchThreshold = 1;
    }

    return {
      docsPath: parsed.docsPath ?? DEFAULT_CONFIG.docsPath,
      matchThreshold,
      contextThreshold,
      recursive: parsed.recursive ?? DEFAULT_CONFIG.recursive,
    };
  } catch (err) {
    console.warn(
      `[doc-injector] Failed to parse config at ${configPath}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ...DEFAULT_CONFIG };
  }
}
