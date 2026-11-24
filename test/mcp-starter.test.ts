import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_CONNECTOR_TEMPLATES, parseMcpConnectorDocument } from "../src/contracts/index.js";

const starterUrl = new URL("../mcp.default.json", import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe("bundled MCP starter", () => {
  it("is valid opt-in config with pinned stdio packages and isolated headless browsing", async () => {
    const starter = JSON.parse(await readFile(starterUrl, "utf8"));
    const document = parseMcpConnectorDocument(starter);
    expect(document.servers).toEqual(
      Object.fromEntries(
        MCP_CONNECTOR_TEMPLATES.map((template) => [template.id, template.definition]),
      ),
    );
    expect(Object.values(document.servers).every((server) => !server.enabled)).toBe(true);
  });

  it("ships as a readable resource in the Node application distribution", async () => {
    vi.stubEnv("CODE60_RELEASE", "0");
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.files).toContain("mcp.default.json");
  });
});
