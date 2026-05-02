/**
 * Document Registry — scans a docs folder, parses frontmatter, maintains index.
 */
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { DocEntry } from "./types";

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { title, keywords, body } or null if no valid frontmatter found.
 */
export function parseFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  if (!content.startsWith("---")) {
    return null;
  }

  const secondDash = content.indexOf("---", 3);
  if (secondDash === -1) {
    return null;
  }

  const frontmatterBlock = content.slice(3, secondDash).trim();
  const body = content.slice(secondDash + 3).trim();

  // Extract title
  const titleMatch = frontmatterBlock.match(/^title:\s*["']?([^"'\n]+)["']?$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extract keywords — supports both flow array [a, b] and block array
  const keywords: string[] = [];

  // Try flow array: keywords: [a, b, c]
  const flowMatch = frontmatterBlock.match(/keywords:\s*\[([^\]]*)\]/);
  if (flowMatch) {
    keywords.push(
      ...flowMatch[1]
        .split(",")
        .map((k) => k.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    );
  } else {
    // Try block array: keywords:\n  - a\n  - b
    const blockMatches = frontmatterBlock.matchAll(/keywords:\s*\n((?:\s*-\s*.+\n?)+)/g);
    for (const bm of blockMatches) {
      const items = bm[1].matchAll(/^\s*-\s*["']?([^"'\n]+)["']?$/gm);
      for (const im of items) {
        const k = im[1].trim();
        if (k) keywords.push(k);
      }
    }
  }

  if (keywords.length === 0) {
    return null;
  }

  return { title: title || "Untitled", keywords, body };
}

/**
 * Document Registry class. Scans a docs folder and maintains an index of DocEntry.
 */
export class DocRegistry {
  private entries: DocEntry[] = [];
  private docsPath: string;
  private recursive: boolean;

  private constructor(docsPath: string, recursive: boolean = true) {
    this.docsPath = docsPath;
    this.recursive = recursive;
  }

  /** Create a registry by scanning the docs folder. */
  static async create(docsPath: string, recursive: boolean = true): Promise<DocRegistry> {
    const registry = new DocRegistry(docsPath, recursive);
    await registry.rebuild();
    return registry;
  }

  /** Re-scan the docs folder and rebuild the index. */
  async rebuild(): Promise<void> {
    const resolved = resolve(this.docsPath);
    const preserved = new Map<string, boolean>();
    for (const e of this.entries) {
      preserved.set(e.filePath, e.injected);
    }

    try {
      const scanResults = this.recursive
        ? this.scanRecursive(resolved)
        : this.scanFlat(resolved);

      const newEntries: DocEntry[] = [];
      for (const { filePath, relativePath, fileName } of scanResults) {
        try {
          const raw = readFileSync(filePath, "utf-8");
          const parsed = parseFrontmatter(raw);
          if (!parsed) {
            console.warn(`[doc-injector] Skipping ${relativePath}: no valid frontmatter with keywords`);
            continue;
          }
          newEntries.push({
            filePath,
            fileName,
            relativePath,
            title: parsed.title,
            keywords: parsed.keywords,
            content: raw,
            injected: preserved.get(filePath) ?? false,
          });
        } catch (err) {
          // Only warn for unexpected errors, not ENOENT (file deleted/moved after scan)
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn(`[doc-injector] Error reading ${relativePath}:`, err);
          }
        }
      }

      this.entries = newEntries;
    } catch {
      console.warn(`[doc-injector] Docs folder not found: ${resolved}`);
      this.entries = [];
    }
  }

  /** Scan top-level .md files only (non-recursive). */
  private scanFlat(dir: string): Array<{ filePath: string; relativePath: string; fileName: string }> {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        filePath: join(dir, f),
        relativePath: f,
        fileName: f,
      }));
  }

  /** Scan .md files recursively, including subdirectories. */
  private scanRecursive(dir: string): Array<{ filePath: string; relativePath: string; fileName: string }> {
    const results: Array<{ filePath: string; relativePath: string; fileName: string }> = [];
    const dirents = readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[];

    for (const dirent of dirents) {
      if (!dirent.isFile() || !dirent.name.endsWith(".md")) continue;

      const fileName = basename(dirent.name);

      // Cross-runtime: when dirent.name is just the filename, resolve the
      // relative path from the parent directory. Use parentPath (Node 18+)
      // with fallback to .path (Bun) for older runtimes.
      let relPath: string;
      if (dirent.name === fileName) {
        const parentPath = (dirent as Dirent & { parentPath?: string; path?: string }).parentPath
          ?? (dirent as Dirent & { path?: string }).path
          ?? "";
        relPath = parentPath
          ? relative(dir, join(parentPath, dirent.name))
          : dirent.name;
      } else {
        // Node-style: dirent.name already contains the relative path from dir
        relPath = dirent.name;
      }

      results.push({
        filePath: join(dir, relPath),
        relativePath: relPath,
        fileName,
      });
    }

    return results;
  }

  /**
   * Get all registered entries.
   *
   * NOTE: Returned DocEntry objects share references with the internal registry.
   * Mutating `injected` on returned objects will affect the registry's internal state.
   * Prefer using markInjected() / markAllNotInjected() for explicit state changes.
   */
  getEntries(): DocEntry[] {
    return [...this.entries];
  }

  /** Get entries that haven't been injected yet. */
  getNonInjectedEntries(): DocEntry[] {
    return this.entries.filter((e) => !e.injected);
  }

  /** Mark entries matching the given file paths as injected. */
  markInjected(filePaths: string[]): void {
    const pathSet = new Set(filePaths);
    for (const e of this.entries) {
      if (pathSet.has(e.filePath)) {
        e.injected = true;
      }
    }
  }

  /** Reset all entries to not-injected state. */
  markAllNotInjected(): void {
    for (const e of this.entries) {
      e.injected = false;
    }
  }

  /** @deprecated Use markAllNotInjected() for clarity. */
  reset(): void {
    this.markAllNotInjected();
  }
}
