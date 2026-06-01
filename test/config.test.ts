import { describe, test, expect } from "vitest";
import { loadConfig } from "../config";
import { silentNotifier } from "./_helpers/silentNotifier";
import { DEFAULT_CONFIG } from "../types";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", async () => {
    const config = await loadConfig("/nonexistent/path", silentNotifier);
    expect(config.docsPath).toBe(DEFAULT_CONFIG.docsPath);
    expect(config.matchThreshold).toBe(DEFAULT_CONFIG.matchThreshold);
    expect(config.contextThreshold).toBe(DEFAULT_CONFIG.contextThreshold);
    expect(config.recursive).toBe(DEFAULT_CONFIG.recursive);
    // New fields should all have defaults
    expect(config.include).toEqual(DEFAULT_CONFIG.include);
    expect(config.exclude).toEqual(DEFAULT_CONFIG.exclude);
    expect(config.maxFileSize).toBe(DEFAULT_CONFIG.maxFileSize);
    expect(config.autoKeywords).toBe(DEFAULT_CONFIG.autoKeywords);
    expect(config.llmKeywords).toBe(DEFAULT_CONFIG.llmKeywords);
    expect(config.maxConcurrent).toBe(DEFAULT_CONFIG.maxConcurrent);
    expect(config.llmBatchSize).toBe(DEFAULT_CONFIG.llmBatchSize);
  });

  test("clamps out-of-range contextThreshold above 100", async () => {
    const tmpDir = join(process.cwd(), ".test-config-clamp-high");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 150 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.contextThreshold).toBe(100);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps out-of-range contextThreshold below 0", async () => {
    const tmpDir = join(process.cwd(), ".test-config-clamp-low");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: -10 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.contextThreshold).toBe(0);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves valid contextThreshold", async () => {
    const tmpDir = join(process.cwd(), ".test-config-valid");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 70 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.contextThreshold).toBe(70);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads recursive setting", async () => {
    const tmpDir = join(process.cwd(), ".test-config-recursive");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ recursive: false }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.recursive).toBe(false);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps matchThreshold below 1 to 1", async () => {
    const tmpDir = join(process.cwd(), ".test-config-match-low");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ matchThreshold: 0 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.matchThreshold).toBe(1);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves valid matchThreshold", async () => {
    const tmpDir = join(process.cwd(), ".test-config-match-valid");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ matchThreshold: 5 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.matchThreshold).toBe(5);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("backward compatible: old 4-field config parses without error", async () => {
    const tmpDir = join(process.cwd(), ".test-config-old-fields");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({
      docsPath: "./my-docs",
      matchThreshold: 2,
      contextThreshold: 50,
      recursive: false,
    }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.docsPath).toBe("./my-docs");
    expect(config.matchThreshold).toBe(2);
    expect(config.contextThreshold).toBe(50);
    expect(config.recursive).toBe(false);
    // New fields get defaults
    expect(config.include).toEqual(DEFAULT_CONFIG.include);
    expect(config.maxFileSize).toBe(DEFAULT_CONFIG.maxFileSize);
    expect(config.autoKeywords).toBe(DEFAULT_CONFIG.autoKeywords);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps maxFileSize below 1024 to 1024", async () => {
    const tmpDir = join(process.cwd(), ".test-config-maxfilesize-low");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ maxFileSize: 500 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.maxFileSize).toBe(1024);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps maxConcurrent to 1-100 range", async () => {
    const tmpDir = join(process.cwd(), ".test-config-maxconcurrent");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ maxConcurrent: 200 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.maxConcurrent).toBe(100);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps llmBatchSize to 1-100 range", async () => {
    const tmpDir = join(process.cwd(), ".test-config-llmbatchsize");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ llmBatchSize: 0 }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.llmBatchSize).toBe(1);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("validateGlobArray rejects non-array include", async () => {
    const tmpDir = join(process.cwd(), ".test-config-bad-include");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ include: "not-an-array" }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.include).toEqual(DEFAULT_CONFIG.include);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("validates include patterns", async () => {
    const tmpDir = join(process.cwd(), ".test-config-include-patterns");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ include: ["**/*.ts", "**/*.md"] }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.include).toEqual(["**/*.ts", "**/*.md"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("non-string entries in glob arrays are filtered", async () => {
    const tmpDir = join(process.cwd(), ".test-config-glob-filter");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ exclude: ["node_modules/**", 123, null, "dist/**"] }));
    const config = await loadConfig(tmpDir, silentNotifier);
    expect(config.exclude).toEqual(["node_modules/**", "dist/**"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});