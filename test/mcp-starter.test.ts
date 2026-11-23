import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/core/index.js";

const starterUrl = new URL("../mcp.default.json", import.meta.url);
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

  it("ships as a readable resource in the Node application distribution", async () => {
    vi.stubEnv("CODE60_RELEASE", "0");
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.files).toContain("mcp.default.json");
  });
});
