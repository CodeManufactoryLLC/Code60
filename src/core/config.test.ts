import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATING_CONTRACT_CLAUSES } from "../contracts/index.js";
import { loadConfig, parseConfig } from "./config.js";
import { UsageError } from "./types.js";

describe("Operating Contract configuration", () => {
  it("accepts the complete clause map under contract.operating and rejects legacy keys", () => {
    const clauses = { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "Custom planning." };
    expect(
      parseConfig({ prompts: { "contract.operating": clauses } }).prompts["contract.operating"],
    ).toEqual(clauses);
    expect(() =>
      parseConfig({
        prompts: { "contract.operating": "Old custom contract" },
      }),
    ).toThrow(/prompts\.contract\.operating/);
    for (const legacy of ["operatingContract", "handoffSummary", "handoffTurn", "workerUpdates"]) {
      expect(() => parseConfig({ prompts: { [legacy]: "x" } })).toThrow(/unknown key/);
    }
  });

  it("rejects incomplete, empty, or unexpected clauses", () => {
    for (const clauses of [
      { role: "Role only." },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "" },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, extra: "Not predefined" },
    ])
      expect(() => parseConfig({ prompts: { "contract.operating": clauses } })).toThrow(
        /prompts\.contract\.operating/,
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
