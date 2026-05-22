/**
 * Shared type definitions for the Doc Injector extension.
 */
/** Default configuration values. */
export const DEFAULT_CONFIG = {
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
export const DEFAULT_MATCHER_OPTIONS = {
    matchThreshold: DEFAULT_CONFIG.matchThreshold,
    caseSensitive: false,
};
//# sourceMappingURL=types.js.map