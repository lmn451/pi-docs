/**
 * LLM Keyword Generation — builds prompts for the LLM to generate keywords
 * for documentation files via the _doc_injector_keywords tool.
 */
/** Input for a single file in a keyword generation batch. */
export interface FileInput {
    /** Path relative to cwd (e.g. "docs/api.md") */
    path: string;
    /** First ~500 chars of the file content as context */
    snippet: string;
    /** Existing keywords (from frontmatter/heuristic), so LLM augments not replaces */
    existingKeywords: string[];
}
/**
 * Build a user message prompt instructing the LLM to generate keywords
 * for a batch of documentation files by calling the _doc_injector_keywords tool.
 *
 * The prompt asks the LLM to read each file's snippet and produce 3-10 concise,
 * searchable keywords per file, incorporating any existing keywords.
 */
export declare function buildKeywordGenPrompt(files: FileInput[]): string;
