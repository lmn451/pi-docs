/**
 * Shared type definitions for the Doc Injector extension.
 */

/** Source of keywords for a doc entry. */
export type KeywordSource = "frontmatter" | "heuristic" | "llm" | "cache";

/** A parsed document from the docs folder. */
export interface DocEntry {
  /** Absolute path on disk */
  filePath: string;
  /** Basename (e.g. "setup.md") */
  fileName: string;
  /** Path relative to docsPath (e.g. "guides/setup.md") */
  relativePath: string;
  /** Document title (from frontmatter or auto-generated) */
  title: string;
  /** Keywords for matching */
  keywords: string[];
  /** Full file content */
  content: string;
  /** Whether this doc has been injected in current session */
  injected: boolean;
  /** Source of keywords */
  keywordSource: KeywordSource;
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

/** Keyword cache file structure. */
export interface KeywordCache {
  version: 1;
  files: Record<string, CacheEntry>; // relativePath → CacheEntry
}

/** A single cache entry for a file. */
export interface CacheEntry {
  mtimeMs: number;
  keywords: string[];
}

/** Result from binary content detection. */
export interface BinaryDetectResult {
  isBinary: boolean;
  reason: "nullByte" | "nonPrintable" | "none";
}

/** Glob filter for include/exclude pattern matching. */
export interface GlobFilter {
  /** Returns true if the path matches any include pattern and no exclude pattern. */
  match(relativePath: string): boolean;
}

/** Extension configuration. */
export interface DocInjectorConfig {
  /** Path to docs folder (relative to cwd) */
  docsPath: string;
  /** Minimum keyword matches to trigger injection */
  matchThreshold: number;
  /** Skip injection if context usage exceeds this % (0-100) */
  contextThreshold: number;
  /** Whether to scan subdirectories */
  recursive: boolean;
  /** Glob patterns for files to include */
  include: string[];
  /** Glob patterns for files/dirs to exclude */
  exclude: string[];
  /** Maximum file size in bytes to parse */
  maxFileSize: number;
  /** Enable auto-generation of keywords when frontmatter is missing */
  autoKeywords: boolean;
  /** Enable LLM-based keyword generation via /doc-keywords-gen */
  llmKeywords: boolean;
  /** Max concurrent file I/O operations */
  maxConcurrent: number;
  /** Max files per LLM keyword-gen batch */
  llmBatchSize: number;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: DocInjectorConfig = {
  docsPath: "./docs",
  matchThreshold: 1,
  contextThreshold: 80,
  recursive: true,
  include: ["**/*.md", "**/*.txt"],
  exclude: ["node_modules/**", ".git/**", "dist/**", "build/**", ".next/**"],
  maxFileSize: 102400, // 100 KB
  autoKeywords: true,
  llmKeywords: true,
  maxConcurrent: 20,
  llmBatchSize: 20,
};

/** Default matcher options derived from config. */
export const DEFAULT_MATCHER_OPTIONS: MatcherOptions = {
  matchThreshold: DEFAULT_CONFIG.matchThreshold,
  caseSensitive: false,
  wordBoundary: true,
};
