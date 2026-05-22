import { type DocInjectorConfig } from "./types";
/**
 * Load config from `.pi/doc-injector.json` relative to the given cwd.
 * Now async — uses readFile from fs/promises.
 * Validates and clamps all numeric fields. Falls back to DEFAULT_CONFIG
 * if file doesn't exist or is invalid.
 */
export declare function loadConfig(cwd: string): Promise<DocInjectorConfig>;
