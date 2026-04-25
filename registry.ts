/**
 * Document Registry — scans a docs folder, parses frontmatter, maintains index.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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

  private constructor(docsPath: string) {
    this.docsPath = docsPath;
  }

  /** Create a registry by scanning the docs folder. */
  static async create(docsPath: string): Promise<DocRegistry> {
    const registry = new DocRegistry(docsPath);
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
      const files = readdirSync(resolved).filter((f) => f.endsWith(".md"));

      const newEntries: DocEntry[] = [];
      for (const file of files) {
        const filePath = join(resolved, file);
        try {
          const raw = readFileSync(filePath, "utf-8");
          const parsed = parseFrontmatter(raw);
          if (!parsed) {
            console.warn(`[doc-injector] Skipping ${file}: no valid frontmatter with keywords`);
            continue;
          }
          newEntries.push({
            filePath,
            fileName: file,
            title: parsed.title,
            keywords: parsed.keywords,
            content: raw,
            injected: preserved.get(filePath) ?? false,
          });
        } catch (err) {
          console.warn(`[doc-injector] Error reading ${file}:`, err);
        }
      }

      this.entries = newEntries;
    } catch {
      console.warn(`[doc-injector] Docs folder not found: ${resolved}`);
      this.entries = [];
    }
  }

  /** Get all registered entries. */
  getEntries(): DocEntry[] {
    return [...this.entries];
  }

  /** Get entries that haven't been injected yet. */
  getNonInjectedEntries(): DocEntry[] {
    return this.entries.filter((e) => !e.injected);
  }

  /** Reset all injected flags. */
  reset(): void {
    for (const e of this.entries) {
      e.injected = false;
    }
  }
}
