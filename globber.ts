/**
 * Glob filter for include/exclude pattern matching.
 * Uses picomatch (0 deps, ~18 KB) to compile patterns once for O(1) matching.
 */
import picomatch from "picomatch";
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
export function createGlobFilter(
  include: string[],
  exclude: string[],
): GlobFilter {
  const includeMatcher =
    include.length > 0
      ? picomatch(include, { dot: true })
      : null;

  const excludeMatcher =
    exclude.length > 0
      ? picomatch(exclude, { dot: true })
      : null;

  return {
    match(relativePath: string): boolean {
      // If include patterns are specified, path must match at least one
      if (includeMatcher && !includeMatcher(relativePath)) {
        return false;
      }
      // Path must not match any exclude pattern
      if (excludeMatcher && excludeMatcher(relativePath)) {
        return false;
      }
      return true;
    },
  };
}
