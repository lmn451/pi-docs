import { describe, it, expect } from "vitest";
import { buildKeywordGenPrompt, FileInput } from "../keyword-llm";

describe("keyword-llm.ts", () => {
  describe("path escaping", () => {
    it("should escape markdown special chars in path", () => {
      const files: FileInput[] = [
        {
          path: "api/auth.md]**bold[more",
          snippet: "Authentication module",
          existingKeywords: [],
        },
      ];

      const prompt = buildKeywordGenPrompt(files);

      // After fix: special chars should be escaped, so unescaped version should NOT appear
      expect(prompt).not.toContain("api/auth.md]**bold[more");
    });

    it("should escape backticks in path", () => {
      const files: FileInput[] = [
        {
          path: "test/`code`.md",
          snippet: "Test file",
          existingKeywords: [],
        },
      ];

      const prompt = buildKeywordGenPrompt(files);
      expect(prompt).toContain("\\`code\\`");
    });
  });
});
