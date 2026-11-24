import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATING_CONTRACT_CLAUSES } from "../contracts/index.js";
import { loadConfig, parseConfig } from "./config.js";
import { UsageError } from "./types.js";

describe("Operating Contract configuration", () => {
  it("accepts the complete clause map and resets old single-block overrides", () => {
    const clauses = { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "Custom planning." };
    expect(
      parseConfig({ prompts: { operatingContract: clauses } }).prompts.operatingContract,
    ).toEqual(clauses);
    expect(
      parseConfig({
        prompts: { operatingContract: "Old custom contract", workerUpdates: "{{updates}}" },
      }).prompts,
    ).toMatchObject({
      operatingContract: DEFAULT_OPERATING_CONTRACT_CLAUSES,
      workerUpdates: "{{updates}}",
    });
  });

  it("rejects incomplete, empty, or unexpected clauses", () => {
    for (const clauses of [
      { role: "Role only." },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "" },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, extra: "Not predefined" },
    ])
      expect(() => parseConfig({ prompts: { operatingContract: clauses } })).toThrow(
        /prompts.operatingContract/,
      );
  });
});

describe("dedicated MCP configuration", () => {
  it("rejects legacy server configuration without returning credentials or arbitrary keys", async () => {
    expect(parseConfig({})).not.toHaveProperty("mcpServers");
    const secret = "sensitive-value-must-not-appear";
    for (const mcpServers of [
      {},
      { local: { type: "stdio", command: secret } },
      { [secret]: secret },
    ]) {
      expect(() => parseConfig({ mcpServers })).toThrow(
        "configuration contains unsupported fields",
      );
      try {
        parseConfig({ mcpServers });
      } catch (error) {
        expect(error).toBeInstanceOf(UsageError);
        expect(String(error)).not.toContain(secret);
      }
    }
    await expect(
      loadConfig({ readFile: async () => `{ "mcpServers": "${secret}" broken }` }, {}),
    ).rejects.toThrow(/invalid JSON$/);
  });
});
