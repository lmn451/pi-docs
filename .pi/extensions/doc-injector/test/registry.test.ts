import { parseFrontmatter } from "../registry";
import { describe, expect, test } from "bun:test";

describe("parseFrontmatter", () => {
  test("parses flow array keywords", () => {
    const content = `---
title: "Test Doc"
keywords: [test, testing, unit test]
---

# Body content here
Some text.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test Doc");
    expect(result!.keywords).toEqual(["test", "testing", "unit test"]);
    expect(result!.body).toContain("# Body content here");
  });

  test("parses block array keywords", () => {
    const content = `---
title: Block Array Doc
keywords:
  - test
  - testing
  - workflow
---

Body text.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Block Array Doc");
    expect(result!.keywords).toEqual(["test", "testing", "workflow"]);
  });

  test("returns null for no frontmatter", () => {
    const content = `# Just a markdown doc
No frontmatter here.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null when no keywords", () => {
    const content = `---
title: No Keywords
---

Some content.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("parses quoted keywords", () => {
    const content = `---
title: "Quoted Keywords"
keywords: ["test", "unit test", "integration"]
---

Body.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.keywords).toEqual(["test", "unit test", "integration"]);
  });

  test("parses quoted title", () => {
    const content = `---
title: 'Multi-word Title'
keywords: [test, workflow]
---

Content.
`;
    const result = parseFrontmatter(content);
    expect(result!.title).toBe("Multi-word Title");
  });
});
