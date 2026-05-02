import { describe, test, expect } from "vitest";
import { loadConfig } from "../config";
import { DEFAULT_CONFIG } from "../types";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.docsPath).toBe(DEFAULT_CONFIG.docsPath);
    expect(config.matchThreshold).toBe(DEFAULT_CONFIG.matchThreshold);
    expect(config.contextThreshold).toBe(DEFAULT_CONFIG.contextThreshold);
    expect(config.recursive).toBe(DEFAULT_CONFIG.recursive);
  });

  test("clamps out-of-range contextThreshold above 100", () => {
    const tmpDir = join(process.cwd(), ".test-config-clamp-high");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 150 }));
    const config = loadConfig(tmpDir);
    expect(config.contextThreshold).toBe(100);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps out-of-range contextThreshold below 0", () => {
    const tmpDir = join(process.cwd(), ".test-config-clamp-low");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: -10 }));
    const config = loadConfig(tmpDir);
    expect(config.contextThreshold).toBe(0);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves valid contextThreshold", () => {
    const tmpDir = join(process.cwd(), ".test-config-valid");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 70 }));
    const config = loadConfig(tmpDir);
    expect(config.contextThreshold).toBe(70);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads recursive setting", () => {
    const tmpDir = join(process.cwd(), ".test-config-recursive");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ recursive: false }));
    const config = loadConfig(tmpDir);
    expect(config.recursive).toBe(false);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps matchThreshold below 1 to 1", () => {
    const tmpDir = join(process.cwd(), ".test-config-match-low");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ matchThreshold: 0 }));
    const config = loadConfig(tmpDir);
    expect(config.matchThreshold).toBe(1);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves valid matchThreshold", () => {
    const tmpDir = join(process.cwd(), ".test-config-match-valid");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ matchThreshold: 5 }));
    const config = loadConfig(tmpDir);
    expect(config.matchThreshold).toBe(5);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});