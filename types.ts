/**
 * Shared type definitions for the Doc Injector extension.
 */

/** A parsed document from the docs folder. */
export interface DocEntry {
  filePath: string;
  fileName: string;
  relativePath: string;
  title: string;
  keywords: string[];
  content: string;
  injected: boolean;
}

/** Options for the keyword matcher. */
export interface MatcherOptions {
  matchThreshold: number;
  caseSensitive: boolean;
  wordBoundary: boolean;
}

/** Result from a keyword match. */
export interface MatchResult {
  entry: DocEntry;
  matchedKeywords: string[];
  hitCount: number;
}

/** Extension configuration. */
export interface DocInjectorConfig {
  docsPath: string;
  matchThreshold: number;
  contextThreshold: number;
  recursive: boolean;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: DocInjectorConfig = {
  docsPath: "./docs",
  matchThreshold: 2,
  contextThreshold: 80,
  recursive: true,
};

/** Default matcher options derived from config. */
export const DEFAULT_MATCHER_OPTIONS: MatcherOptions = {
  matchThreshold: DEFAULT_CONFIG.matchThreshold,
  caseSensitive: false,
  wordBoundary: true,
};
