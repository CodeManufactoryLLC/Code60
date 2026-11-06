import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from "../bridge/index.js";
import { CODE60_VERSION } from "../core/index.js";
import { handleMcpRequest } from "./mcp-server.js";

afterEach(() => vi.restoreAllMocks());

describe("MCP initialization", () => {
  it.each([...MCP_PROTOCOL_VERSIONS, "unknown"])(
    "negotiates %s and reports the Code60 version",
    async (requested) => {
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await handleMcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: requested },
      });
      expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
        id: 1,
        result: {
          protocolVersion: requested === "unknown" ? MCP_PROTOCOL_VERSION : requested,
          serverInfo: { name: "code60", version: CODE60_VERSION },
        },
      });
    },
  );
});
