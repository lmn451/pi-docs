import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = (name: string) =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));

describe("incremental TypeScript hardening", () => {
  it("enforces strict indexed and optional access in the dependency-light core", () => {
    const config = readJson("tsconfig.core.json");
    expect(config.extends).toBe("./tsconfig.json");
    expect(config.compilerOptions).toMatchObject({
      noEmit: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: false,
    });
    expect(config.include).toEqual(
      expect.arrayContaining([
        "types.ts",
        "matcher.ts",
        "keyword-gen.ts",
        "keyword-llm.ts",
        "injector.ts",
        "typechecks/core.test-d.ts",
      ]),
    );
  });

  it("runs the core contracts as part of the mandatory typecheck", () => {
    const { scripts } = readJson("package.json");
    expect(scripts["typecheck:core"]).toBe("tsc -p tsconfig.core.json");
    expect(scripts.typecheck).toContain("npm run typecheck:core");
  });
});
