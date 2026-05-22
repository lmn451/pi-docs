/**
 * Local keyword generation — extracts keywords from filenames and content
 * when no frontmatter is available.
 *
 * Extraction sources:
 *   1. Filename parts (split on -, _, .)
 *   2. Markdown headings (# Title, ## Title, etc.)
 *   3. Code symbols (function, class, const, interface, type, enum)
 *
 * All keywords are lowercased, deduplicated, and filtered through a stop-word list.
 * Output is capped at 20 keywords.
 */
/**
 * Generate up to 20 keywords from a file's name and content.
 *
 * Sources (in order, each adds keywords until cap is reached):
 *   1. Filename parts — split on `-`, `_`, and `.`, keep segments ≥ 3 chars
 *   2. Markdown headings — text after `#` markers
 *   3. Code symbols — function/class/const/interface/type/enum declarations
 *
 * Each candidate is lowercased, filtered through a stop-word list, deduplicated,
 * and limited to words with ≥ 3 characters.
 *
 * @param fileName - The basename of the file (e.g. "api-authentication.md")
 * @param content  - The full file content
 * @returns Up to 20 deduplicated keyword strings
 */
export declare function generateKeywords(fileName: string, content: string): string[];
