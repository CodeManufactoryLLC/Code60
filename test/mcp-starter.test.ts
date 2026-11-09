import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/core/index.js";

const starterUrl = new URL("../mcp.default.json", import.meta.url);
const require = createRequire(import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe("bundled MCP starter", () => {
  it("is valid opt-in config with pinned stdio packages and isolated headless browsing", async () => {
    const starter = JSON.parse(await readFile(starterUrl, "utf8"));
    expect(parseConfig({}).mcpServers).toEqual({});
    expect(parseConfig(starter).mcpServers).toEqual(starter.mcpServers);
    expect(starter.mcpServers).toEqual({
      playwright: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@0.0.84", "--isolated", "--headless"],
        env: {},
      },
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@4.5.1"],
        env: {},
      },
    });
  });

  it("ships as a readable resource in desktop and CLI distributions", async () => {
    vi.stubEnv("CODE60_RELEASE", "0");
    const packaging = require("../scripts/packaging-config.cjs");
    expect(packaging.extraResources).toContainEqual({
      from: "mcp.default.json",
      to: "mcp.default.json",
    });
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.files).toContain("mcp.default.json");
  });
});
