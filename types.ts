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
  /**
   * If > 0, only the last `windowSize` characters of the text are scanned.
   * Used by the streaming path to bound per-chunk scan cost; 0 disables
   * windowing (scan the full text), which is the default for one-shot matches.
   */
  windowSize: number;
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
  /**
   * Size (in chars) of the rolling tail window scanned on each streaming chunk.
   * Bounds per-chunk scan cost; matches still accumulate across chunks so the
   * threshold can be met even when keywords scroll out of the window. 0 = scan
   * the full accumulated buffer.
   */
  streamWindowSize: number;
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
  matchThreshold: 2,
  streamWindowSize: 500,
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
  // Default to no windowing; the streaming caller opts in via streamWindowSize.
  windowSize: 0,
};

/**
 * Sentinel value used in CacheEntry.mtimeMs to mark entries written by the
 * LLM keyword generator. -1 is chosen because Node.Stats.mtimeMs is documented
 * as a non-negative integer (milliseconds since the Unix Epoch), so a real
 * file can never have mtimeMs === -1. Heuristic-written entries use the real
 * file mtime, which is always >= 0.
 *
 * If you find yourself writing LLM_CACHE_SENTINEL into a real cache entry
 * from a non-LLM code path, that's a bug.
 */
export const LLM_CACHE_SENTINEL = -1;
