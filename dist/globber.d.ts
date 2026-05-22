import type { GlobFilter } from "./types";
/**
 * Create a glob filter from include and exclude patterns.
 *
 * A path matches if it matches at least one `include` pattern AND
 * does not match any `exclude` pattern.
 *
 * When `include` is empty, all files are considered included
 * (subject to exclude filtering).
 *
 * @param include - Glob patterns for files to include
 * @param exclude - Glob patterns for files/dirs to exclude
 * @returns A GlobFilter with a `match` method
 */
export declare function createGlobFilter(include: string[], exclude: string[]): GlobFilter;
