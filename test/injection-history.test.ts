import { expect, test } from "vitest";
import { readInjectionHistory, type InjectionAuditDetails } from "../audit";

const validDetails: InjectionAuditDetails = {
  version: 1,
  mode: "simple",
  boundary: "turn_end",
  turnIndex: 4,
  documents: [
    {
      relativePath: "auth.md",
      keywordSource: "filename",
      triggers: [
        { source: "assistant", matchedKeywords: ["auth"] },
        { source: "input", matchedKeywords: ["AUTH"] },
      ],
    },
    {
      relativePath: "guides/billing.md",
      keywordSource: "frontmatter",
      triggers: [{ source: "assistant", matchedKeywords: ["invoice"] }],
    },
  ],
};

function customMessage(
  id: string,
  timestamp: number | string,
  details: unknown,
  customType = "doc-injector",
) {
  return {
    type: "custom_message",
    customType,
    id,
    timestamp,
    details,
  };
}

test("history flattens documents in native chronological branch order", () => {
  const history = readInjectionHistory([
    { type: "message", id: "user-1", timestamp: 1 },
    customMessage("entry-1", 1_700_000_000_000, validDetails),
    customMessage("other-extension", NaN, null, "other-extension"),
    customMessage("entry-2", "2024-01-01T00:00:00.000Z", {
      version: 1,
      mode: "simple",
      boundary: "before_agent_start",
      documents: [validDetails.documents[0]],
    }),
  ]);

  expect(history).toEqual({
    unavailableMessages: 0,
    records: [
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        entryId: "entry-1",
        mode: "simple",
        boundary: "turn_end",
        turnIndex: 4,
        relativePath: "auth.md",
        keywordSource: "filename",
        triggers: [
          { source: "assistant", matchedKeywords: ["auth"] },
          { source: "input", matchedKeywords: ["AUTH"] },
        ],
      },
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        entryId: "entry-1",
        mode: "simple",
        boundary: "turn_end",
        turnIndex: 4,
        relativePath: "guides/billing.md",
        keywordSource: "frontmatter",
        triggers: [{ source: "assistant", matchedKeywords: ["invoice"] }],
      },
      {
        timestamp: "2024-01-01T00:00:00.000Z",
        entryId: "entry-2",
        mode: "simple",
        boundary: "before_agent_start",
        relativePath: "auth.md",
        keywordSource: "filename",
        triggers: [
          { source: "assistant", matchedKeywords: ["auth"] },
          { source: "input", matchedKeywords: ["AUTH"] },
        ],
      },
    ],
  });
});

test("matching legacy and malformed injector entries are unavailable", () => {
  const invalidDetails = [
    undefined,
    { ...validDetails, version: 2 },
    { ...validDetails, mode: "unknown" },
    { ...validDetails, boundary: "agent_start" },
    { ...validDetails, boundary: "before_agent_start", turnIndex: 0 },
    { ...validDetails, documents: [] },
    {
      ...validDetails,
      documents: [{ ...validDetails.documents[0], relativePath: " " }],
    },
    {
      ...validDetails,
      documents: [{ ...validDetails.documents[0], keywordSource: "unknown" }],
    },
    {
      ...validDetails,
      documents: [{ ...validDetails.documents[0], triggers: [] }],
    },
    {
      ...validDetails,
      documents: [
        {
          ...validDetails.documents[0],
          triggers: [{ source: "assistant", matchedKeywords: [" "] }],
        },
      ],
    },
  ];
  const entries: unknown[] = invalidDetails.map((details, index) =>
    customMessage(`invalid-${index}`, 1_700_000_000_000, details),
  );
  entries.push({
    type: "custom_message",
    customType: "doc-injector",
    timestamp: 1_700_000_000_000,
    details: validDetails,
  });
  entries.push(customMessage("invalid-timestamp", Number.NaN, validDetails));

  const history = readInjectionHistory([
    ...entries,
    { type: "message", customType: "doc-injector" },
    customMessage("unrelated", Number.NaN, undefined, "not-doc-injector"),
  ]);

  expect(history.records).toEqual([]);
  expect(history.unavailableMessages).toBe(invalidDetails.length + 2);
});
