import { describe, expect, it } from "vitest";
import { parseMcpConnectorDocument } from "../bridge/index.js";
import { type McpConnectorRole, resolveMcpConnectors } from "./index.js";

const server = (label: string, enabled = true) => ({
  label,
  enabled,
  type: "stdio",
  command: "node",
});
const document = (servers: Record<string, unknown>) =>
  parseMcpConnectorDocument({ version: 1, servers });
const user = {
  document: document({ docs: server("User docs"), shared: server("Shared") }),
  revision: "u1",
};
const project = {
  document: document({ docs: server("Project docs"), local: server("Local") }),
  projectId: "canonical-project-a",
  revision: "p1",
};
const approval = { projectId: project.projectId, revision: project.revision };

describe("pure MCP configuration selection", () => {
  it("selects approved project overrides and reports shadowed user sources deterministically", () => {
    const resolved = resolveMcpConnectors({ role: "project-chat", user, project, approval });
    expect(resolved.blockedReason).toBeUndefined();
    expect(resolved.connectors.map((item) => item.status.id)).toEqual(["docs", "local", "shared"]);
    expect(resolved.connectors[0]).toMatchObject({
      definition: { label: "Project docs" },
      status: {
        source: { scope: "project", projectId: project.projectId, revision: "p1" },
        shadowedSources: [{ scope: "user", revision: "u1" }],
        approval: "approved",
        eligibility: "eligible",
      },
    });
    expect(resolved.connectors[1]?.status.shadowedSources).toEqual([]);
    expect(resolved.connectors[2]?.status).toMatchObject({
      approval: "not-required",
      eligibility: "eligible",
      source: { scope: "user", revision: "u1" },
    });
  });

  it("never falls back when a project override is disabled or awaiting approval", () => {
    for (const enabled of [true, false]) {
      const result = resolveMcpConnectors({
        role: "worker",
        user,
        project: { ...project, document: document({ docs: server("Project", enabled) }) },
      });
      expect(result.connectors[0]?.definition.label).toBe("Project");
      expect(result.connectors[0]?.status).toMatchObject({
        approval: "required",
        enabled,
        eligibility: enabled ? "approval-required" : "disabled",
      });
    }
    expect(
      resolveMcpConnectors({
        role: "project-chat",
        user,
        project: { ...project, document: document({ docs: server("Off", false) }) },
        approval,
      }).connectors[0]?.status,
    ).toMatchObject({ approval: "approved", eligibility: "disabled" });
  });

  it.each([
    { projectId: "replacement-project", revision: "p1" },
    { projectId: project.projectId, revision: "changed" },
  ])("invalidates stale project approval %#", (approval) => {
    expect(
      resolveMcpConnectors({ role: "project-chat", user, project, approval }).connectors[0]?.status
        .eligibility,
    ).toBe("approval-required");
  });

  it.each(["relay", "custom-assistant"] as const)(
    "uses only user definitions for %s even with project state present",
    (role) => {
      const result = resolveMcpConnectors({ role, user, project, approval });
      expect(result.connectors.map((item) => item.definition.label)).toEqual([
        "User docs",
        "Shared",
      ]);
      expect(result.connectors.every((item) => item.status.source.scope === "user")).toBe(true);
    },
  );

  it("uses the supplied execution target for workers and requires one for project chats", () => {
    expect(
      resolveMcpConnectors({ role: "worker", user, project, approval }).connectors[0]?.definition
        .label,
    ).toBe("Project docs");
    expect(resolveMcpConnectors({ role: "worker", user }).connectors).toHaveLength(2);
    expect(resolveMcpConnectors({ role: "project-chat", user })).toEqual({
      blockedReason: "project-required",
      connectors: [],
    });
  });

  const excluded: McpConnectorRole[] = [
    "scheduler",
    "provider-verification",
    "memory-helper",
    "search-helper",
    "isolated-helper",
  ];
  it.each(excluded)("gives no definitions to %s", (role) => {
    expect(resolveMcpConnectors({ role, user, project, approval })).toEqual({
      blockedReason: "role-excluded",
      connectors: [],
    });
  });

  it("handles empty scopes and disabled user entries without inventing health or authentication", () => {
    expect(
      resolveMcpConnectors({ role: "relay", user: { document: document({}), revision: "empty" } })
        .connectors,
    ).toEqual([]);
    const result = resolveMcpConnectors({
      role: "relay",
      user: { ...user, document: document({ docs: server("Off", false) }) },
    });
    expect(result.connectors[0]?.status.eligibility).toBe("disabled");
    expect(result.connectors[0]?.status).not.toHaveProperty("connection");
    expect(result.connectors[0]?.status).not.toHaveProperty("authentication");
  });

  it("never mutates inputs, aliases mutable definitions or mistakes inherited properties for overrides", () => {
    const input = {
      role: "project-chat" as const,
      user: structuredClone(user),
      project: structuredClone(project),
      approval: { ...approval },
    };
    const before = structuredClone(input);
    const result = resolveMcpConnectors(input);
    const first = result.connectors[0];
    if (!first) throw new Error("missing fixture");
    first.definition.label = "changed";
    first.status.source.revision = "changed";
    expect(input).toEqual(before);
    expect(resolveMcpConnectors(input).connectors[0]?.definition.label).toBe("Project docs");
    const inherited = resolveMcpConnectors({
      role: "worker",
      user: { document: document({ constructor: server("Own") }), revision: "u1" },
      project: { ...project, document: document({}) },
    });
    expect(inherited.connectors[0]?.status.source.scope).toBe("user");
  });
});
