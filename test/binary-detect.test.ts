import { describe, test, expect } from "vitest";
import { isBinaryExtension, isBinaryContent, KNOWN_TEXT_EXTENSIONS } from "../binary-detect";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("isBinaryExtension", () => {
  test("returns true for image extensions", () => {
    expect(isBinaryExtension("photo.png")).toBe(true);
    expect(isBinaryExtension("image.jpg")).toBe(true);
    expect(isBinaryExtension("icon.jpeg")).toBe(true);
    expect(isBinaryExtension("anim.gif")).toBe(true);
    expect(isBinaryExtension("logo.bmp")).toBe(true);
    expect(isBinaryExtension("favicon.ico")).toBe(true);
  });

  test("returns true for archive extensions", () => {
    expect(isBinaryExtension("bundle.zip")).toBe(true);
    expect(isBinaryExtension("archive.tar")).toBe(true);
    expect(isBinaryExtension("data.gz")).toBe(true);
    expect(isBinaryExtension("file.7z")).toBe(true);
  });

  test("returns true for font extensions", () => {
    expect(isBinaryExtension("font.ttf")).toBe(true);
    expect(isBinaryExtension("font.otf")).toBe(true);
    expect(isBinaryExtension("icon.woff")).toBe(true);
    expect(isBinaryExtension("icon.woff2")).toBe(true);
  });

  test("returns true for executables", () => {
    expect(isBinaryExtension("app.exe")).toBe(true);
    expect(isBinaryExtension("lib.dll")).toBe(true);
    expect(isBinaryExtension("lib.so")).toBe(true);
    expect(isBinaryExtension("module.wasm")).toBe(true);
  });

  test("returns true for audio/video", () => {
    expect(isBinaryExtension("song.mp3")).toBe(true);
    expect(isBinaryExtension("recording.wav")).toBe(true);
    expect(isBinaryExtension("video.mp4")).toBe(true);
    expect(isBinaryExtension("clip.mov")).toBe(true);
  });

  test("returns true for document formats", () => {
    expect(isBinaryExtension("report.pdf")).toBe(true);
    expect(isBinaryExtension("sheet.xlsx")).toBe(true);
  });

  test("returns false for text extensions", () => {
    expect(isBinaryExtension("readme.md")).toBe(false);
    expect(isBinaryExtension("index.ts")).toBe(false);
    expect(isBinaryExtension("config.json")).toBe(false);
    expect(isBinaryExtension("style.css")).toBe(false);
    expect(isBinaryExtension("index.html")).toBe(false);
    expect(isBinaryExtension("app.py")).toBe(false);
    expect(isBinaryExtension("main.rs")).toBe(false);
    expect(isBinaryExtension("script.sh")).toBe(false);
  });

  test("returns false for extensions not in blacklist", () => {
    expect(isBinaryExtension("file.txt")).toBe(false);
    expect(isBinaryExtension("data.csv")).toBe(false);
    expect(isBinaryExtension("config.yaml")).toBe(false);
  });

  test("handles uppercase extensions", () => {
    expect(isBinaryExtension("PHOTO.PNG")).toBe(true);
    expect(isBinaryExtension("README.MD")).toBe(false);
  });
});

describe("isBinaryContent", () => {
  const tmpDir = join(process.cwd(), ".test-binary-detect");

  function setup() {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  }

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  test("detects null byte in content", async () => {
    setup();
    try {
      const buf = Buffer.alloc(100, 0x41); // 'A'
      buf[50] = 0x00; // null byte
      writeFileSync(join(tmpDir, "null-byte.bin"), buf);
      const result = await isBinaryContent(join(tmpDir, "null-byte.bin"));
      expect(result.isBinary).toBe(true);
      expect(result.reason).toBe("nullByte");
    } finally {
      cleanup();
    }
  });

  test("detects >30% non-printable as binary", async () => {
    setup();
    try {
      const buf = Buffer.alloc(1000, 0x00); // all nulls — definitely binary
      // But we need null bytes to NOT be the only thing detected,
      // use non-printable non-null bytes (e.g., 0x01)
      const buf2 = Buffer.alloc(1000, 0x01); // SOH, non-printable, not null
      writeFileSync(join(tmpDir, "control.bin"), buf2);
      const result = await isBinaryContent(join(tmpDir, "control.bin"));
      expect(result.isBinary).toBe(true);
      expect(result.reason).toBe("nonPrintable");
    } finally {
      cleanup();
    }
  });

  test("returns not binary for plain text", async () => {
    setup();
    try {
      writeFileSync(
        join(tmpDir, "text.txt"),
        "Hello, world! This is plain text content.\nLine 2.\nLine 3 with symbols: @#$%^&*()",
        "utf-8",
      );
      const result = await isBinaryContent(join(tmpDir, "text.txt"));
      expect(result.isBinary).toBe(false);
      expect(result.reason).toBe("none");
    } finally {
      cleanup();
    }
  });

  test("returns not binary for empty file", async () => {
    setup();
    try {
      writeFileSync(join(tmpDir, "empty.txt"), "");
      const result = await isBinaryContent(join(tmpDir, "empty.txt"));
      expect(result.isBinary).toBe(false);
      expect(result.reason).toBe("none");
    } finally {
      cleanup();
    }
  });

  test("returns not binary for very short text file", async () => {
    setup();
    try {
      writeFileSync(join(tmpDir, "short.txt"), "hi", "utf-8");
      const result = await isBinaryContent(join(tmpDir, "short.txt"));
      expect(result.isBinary).toBe(false);
      expect(result.reason).toBe("none");
    } finally {
      cleanup();
    }
  });

  test("returns not binary for UTF-8 with multi-byte chars", async () => {
    setup();
    try {
      writeFileSync(
        join(tmpDir, "utf8.txt"),
        "Hello 世界! Café résumé naïve — emoji test 🎉✨",
        "utf-8",
      );
      const result = await isBinaryContent(join(tmpDir, "utf8.txt"));
      expect(result.isBinary).toBe(false);
      expect(result.reason).toBe("none");
    } finally {
      cleanup();
    }
  });

  test("nonPrintable threshold: 0% non-printable -> not binary", async () => {
    setup();
    try {
      const buf = Buffer.alloc(200, 0x41); // all 'A' — all printable
      writeFileSync(join(tmpDir, "all-ascii.bin"), buf);
      const result = await isBinaryContent(join(tmpDir, "all-ascii.bin"));
      expect(result.isBinary).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("nonPrintable threshold: 50% non-printable -> binary", async () => {
    setup();
    try {
      // 500 printable bytes + 500 non-printable bytes (0x01) = 50% non-printable
      const printable = Buffer.alloc(500, 0x41);
      const nonPrintable = Buffer.alloc(500, 0x01);
      writeFileSync(join(tmpDir, "half.bin"), Buffer.concat([printable, nonPrintable]));
      const result = await isBinaryContent(join(tmpDir, "half.bin"));
      expect(result.isBinary).toBe(true);
      expect(result.reason).toBe("nonPrintable");
    } finally {
      cleanup();
    }
  });

  test("Markdown file with frontmatter is not binary", async () => {
    setup();
    try {
      writeFileSync(
        join(tmpDir, "doc.md"),
        "---\ntitle: Test\nkeywords: [a, b]\n---\n\n# Hello World\n\nThis is a doc.",
        "utf-8",
      );
      const result = await isBinaryContent(join(tmpDir, "doc.md"));
      expect(result.isBinary).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("TypeScript file is not binary", async () => {
    setup();
    try {
      writeFileSync(
        join(tmpDir, "app.ts"),
        'import { foo } from "./foo";\n\nexport function bar(): string {\n  return "hello";\n}\n',
        "utf-8",
      );
      const result = await isBinaryContent(join(tmpDir, "app.ts"));
      expect(result.isBinary).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("KNOWN_TEXT_EXTENSIONS", () => {
  test("has at least 28 entries", () => {
    expect(KNOWN_TEXT_EXTENSIONS.size).toBeGreaterThanOrEqual(28);
  });

  test("includes common text extensions", () => {
    expect(KNOWN_TEXT_EXTENSIONS.has(".md")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".ts")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".js")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".json")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".yaml")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".yml")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".toml")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".txt")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".css")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".html")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".py")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".rs")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".go")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".java")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".c")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".h")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".cpp")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".rb")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".sh")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".graphql")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".prisma")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".proto")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".vue")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".svelte")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".xml")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".svg")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".gitignore")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".dockerignore")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".editorconfig")).toBe(true);
    expect(KNOWN_TEXT_EXTENSIONS.has(".env")).toBe(true);
  });

  test("excludes binary extensions", () => {
    expect(KNOWN_TEXT_EXTENSIONS.has(".png")).toBe(false);
    expect(KNOWN_TEXT_EXTENSIONS.has(".zip")).toBe(false);
    expect(KNOWN_TEXT_EXTENSIONS.has(".exe")).toBe(false);
    expect(KNOWN_TEXT_EXTENSIONS.has(".pdf")).toBe(false);
    expect(KNOWN_TEXT_EXTENSIONS.has(".mp4")).toBe(false);
    expect(KNOWN_TEXT_EXTENSIONS.has(".ttf")).toBe(false);
  });
});
