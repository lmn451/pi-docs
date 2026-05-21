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

const STOP_WORDS = new Set<string>([
  // Articles
  "a", "an", "the",
  // Pronouns
  "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what",
  // Prepositions
  "in", "on", "at", "by", "for", "with", "about",
  "to", "from", "of", "into", "onto", "upon",
  "over", "under", "between", "among", "through",
  "during", "before", "after", "above", "below",
  "up", "down", "out", "off",
  // Conjunctions
  "and", "but", "or", "nor", "so", "yet", "for",
  "if", "then", "than", "as", "when", "while",
  "because", "since", "although", "though",
  // Auxiliary/modal verbs
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing",
  "will", "would", "shall", "should", "can", "could",
  "may", "might", "must",
  // Common adverbs
  "not", "no", "yes",
  "just", "only", "also", "too", "very", "now", "then",
  "here", "there", "where", "how", "why",
  "all", "each", "every", "both", "few", "more", "most",
  "some", "any", "other", "another", "such",
  "much", "many", "little", "less",
  // Common content-less words
  "get", "set", "put", "use", "make", "see", "need",
  "one", "two", "three", "first", "second", "third",
  "using", "used", "into", "onto", "new",
  "note", "notes", "example", "examples", "todo",
]);

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
export function generateKeywords(
  fileName: string,
  content: string,
): string[] {
  const keywords: string[] = [];

  // Source 1: Filename parts
  addFromFilename(fileName, keywords);

  // Source 2: Markdown headings
  addFromHeadings(content, keywords);

  // Source 3: Code symbols
  addFromCodeSymbols(content, keywords);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(kw);
  }

  return result.slice(0, 20);
}

/** Extract keyword candidates from filename parts. */
function addFromFilename(fileName: string, out: string[]): void {
  // Strip extension(s)
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");

  // Split on common delimiters
  const parts = nameWithoutExt.split(/[-_.\s]+/);

  for (const part of parts) {
    const cleaned = part.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned)) {
      out.push(cleaned);
    }
  }
}

/** Extract keyword candidates from markdown headings (#, ##, ###, etc.). */
function addFromHeadings(content: string, out: string[]): void {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    const headingText = match[1].trim();
    // Split heading into words
    const words = headingText.split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned)) {
        out.push(cleaned);
      }
    }
  }
}

/** Extract keyword candidates from code symbol declarations. */
function addFromCodeSymbols(content: string, out: string[]): void {
  // Match: function name, class name, const name, interface name, type name, enum name
  // Also: export function, export class, export const, etc.
  const symbolRegex = /(?:export\s+)?(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = symbolRegex.exec(content)) !== null) {
    const name = match[1];
    const cleaned = name.toLowerCase();
    if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned)) {
      out.push(cleaned);
    }
  }
}
