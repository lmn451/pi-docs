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

    return {
      docsPath: parsed.docsPath ?? DEFAULT_CONFIG.docsPath,
      matchThreshold: parsed.matchThreshold ?? DEFAULT_CONFIG.matchThreshold,
    };
  } catch (err) {
    console.warn(
      `[doc-injector] Failed to parse config at ${configPath}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ...DEFAULT_CONFIG };
  }
}
