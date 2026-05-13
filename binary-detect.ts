/**
 * Binary file detection — two-tier with known-text extension whitelist.
 *
 * Pipeline (zero/minimal I/O where possible):
 * 1. `isBinaryExtension(filePath)` — extension blacklist, no I/O
 * 2. `KNOWN_TEXT_EXTENSIONS` whitelist check — skip content sampling for common text
 * 3. `isBinaryContent(filePath)` — null-byte + >30% non-printable on first 8KB
 *
 * Uses static `import { open } from "node:fs/promises"` — NOT dynamic import.
 */
import { open } from "node:fs/promises";
import type { BinaryDetectResult } from "./types";

/**
 * Binary file extensions that are always skipped (no I/O).
 * Covers images, archives, fonts, executables, audio, video, documents, etc.
 */
const BINARY_EXTENSIONS = new Set<string>([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svgz", ".webp",
  ".tiff", ".tif", ".psd", ".ai", ".eps",
  // Archives
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".tgz",
  // Fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // Executables / shared libs
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  // Audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
  // Video
  ".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv",
  // Documents (non-text binary)
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Other
  ".class", ".pyc", ".pyd", ".pyo",
  ".lockb", // Bun/Yarn lockfiles
  ".db", ".sqlite", ".sqlite3",
]);

/**
 * Common text file extensions that are ALWAYS text.
 * Files with these extensions skip `isBinaryContent` entirely (zero I/O).
 */
export const KNOWN_TEXT_EXTENSIONS = new Set<string>([
  ".md", ".mdx",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".json5",
  ".yaml", ".yml", ".toml",
  ".txt", ".text", ".log",
  ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".xml", ".svg", ".xhtml",
  ".py", ".pyi", ".pyx",
  ".rs",
  ".go",
  ".java",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".hh",
  ".rb",
  ".sh", ".bash", ".zsh",
  ".graphql", ".gql",
  ".prisma",
  ".proto",
  ".vue", ".svelte",
  ".gitignore", ".dockerignore", ".editorconfig",
  ".env", ".env.example",
  ".csv", ".tsv",
  ".ini", ".cfg", ".conf",
  ".sql",
  ".php",
]);

/**
 * Check if a file path has a known binary extension.
 * Pure function — zero I/O.
 *
 * @param filePath - The file path to check
 * @returns true if the extension is in the binary extension blacklist
 */
export function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if file content appears to be binary by reading the first 8KB.
 *
 * Binary indicators:
 * - Contains a null byte (0x00) — definitive binary marker
 * - More than 30% of bytes are non-printable and outside the UTF-8 continuation range
 *
 * @param filePath - Absolute path to the file
 * @returns BinaryDetectResult with isBinary flag and reason string
 */
export async function isBinaryContent(
  filePath: string,
): Promise<BinaryDetectResult> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    if (bytesRead === 0) {
      return { isBinary: false, reason: "none" };
    }

    let nonPrintable = 0;
    const end = bytesRead;

    for (let i = 0; i < end; i++) {
      const byte = buf[i];
      if (byte === 0) {
        return { isBinary: true, reason: "nullByte" };
      }
      // Non-printable: control chars (0x00-0x08, 0x0E-0x1F, 0x7F) except
      // common whitespace: \t (0x09), \n (0x0A), \r (0x0D)
      // Also treat continuation bytes 0x80-0xBF as printable (part of multi-byte UTF-8)
      // Treat bytes >= 0xC0 as printable (UTF-8 leading bytes)
      if (
        (byte < 0x09) ||
        (byte === 0x0B) || (byte === 0x0C) ||
        (byte >= 0x0E && byte <= 0x1F) ||
        (byte === 0x7F)
      ) {
        nonPrintable++;
      }
    }

    const ratio = nonPrintable / end;
    if (ratio > 0.3) {
      return { isBinary: true, reason: "nonPrintable" };
    }

    return { isBinary: false, reason: "none" };
  } finally {
    await fh?.close();
  }
}
