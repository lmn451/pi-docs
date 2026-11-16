import { KeywordMatcher } from "../matcher";
import type { DocEntry, MatcherOptions } from "../types";

const entries: readonly DocEntry[] = [];
// @ts-expect-error An indexed entry may be absent.
const unchecked: DocEntry = entries[0];
const checked: DocEntry | undefined = entries[0];

new KeywordMatcher([], {});
new KeywordMatcher([], { windowSize: 0 });
// @ts-expect-error Optional overrides must be omitted, not explicitly undefined.
new KeywordMatcher([], { windowSize: undefined });
// @ts-expect-error Optional overrides must not erase the threshold default.
const invalidOptions: Partial<MatcherOptions> = { matchThreshold: undefined };

void unchecked;
void checked;
void invalidOptions;
