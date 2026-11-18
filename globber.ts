/**
 * Glob filter for include/exclude pattern matching.
 * Patterns are compiled once into Minimatch's non-recursive matchers.
 */
import { Minimatch } from "minimatch";
import type { GlobFilter } from "./types";

// Preserve literal # and leading-! behavior while keeping extglobs enabled.
const globOptions = { dot: true, nocomment: true, nonegate: false };

function compilePatterns(patterns: string[]): Minimatch[] {
  const matchers: Minimatch[] = [];
  for (const pattern of patterns) {
    matchers.push(new Minimatch(pattern, globOptions));
  }
  return matchers;
}

function matchesAny(
  matchers: readonly Minimatch[],
  relativePath: string,
): boolean {
  for (const matcher of matchers) {
    if (matcher.match(relativePath)) {
      return true;
    }
  }
  return false;
}

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
  const includeMatchers = include.length > 0 ? compilePatterns(include) : null;

  const excludeMatchers = exclude.length > 0 ? compilePatterns(exclude) : null;

  return {
    match(relativePath: string): boolean {
      // If include patterns are specified, path must match at least one
      if (includeMatchers && !matchesAny(includeMatchers, relativePath)) {
        return false;
      }
      // Path must not match any exclude pattern
      if (excludeMatchers && matchesAny(excludeMatchers, relativePath)) {
        return false;
      }
      return true;
    },
  };
}
