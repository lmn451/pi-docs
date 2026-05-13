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
export function buildKeywordGenPrompt(files: FileInput[]): string {
  if (files.length === 0) return "";

  const fileDescriptions = files.map((f, i) => {
    const existing = f.existingKeywords.length > 0
      ? `  Existing keywords: ${f.existingKeywords.join(", ")}`
      : "";
    const safeSnippet = f.snippet.replace(/```/g, "'''");
    return `${i + 1}. **${f.path}**\n${existing}\n   Snippet:\n\`\`\`\n${safeSnippet}\n\`\`\``;
  }).join("\n\n");

  const expectedOutput = files.map((f) => {
    const existingSet = new Set(f.existingKeywords.map(k => k.toLowerCase()));
    return `  - "${f.path}": keywords array incorporating relevant existing keywords [${f.existingKeywords.slice(0, 5).map(k => `"${k}"`).join(", ")}${f.existingKeywords.length > 5 ? ", ..." : ""}]`;
  }).join("\n");

  return `Generate documentation keywords for the following ${files.length} file(s). For each file, read the snippet and produce 3-10 concise, searchable keywords that someone might type when looking for this documentation.

Rules:
- Keywords should be lowercase, 3+ characters, no stop-words
- Incorporate any existing keywords that are still relevant
- Focus on the document's core topic, not generic terms
- Prefer specific technical terms over vague ones

Files:
${fileDescriptions}

After analysis, call the \`_doc_injector_keywords\` tool with a \`keywords\` array like:
${expectedOutput}

Do not output any other text — just call the tool with the keywords.`;
}
