import type {
  McpConnectorConfigurationStatus,
  McpConnectorDefinition,
  McpConnectorDocument,
  McpConnectorSource,
} from "../bridge/index.js";

export type McpConnectorRole =
  | "relay"
  | "custom-assistant"
  | "project-chat"
  | "worker"
  | "scheduler"
  | "provider-verification"
  | "memory-helper"
  | "search-helper"
  | "isolated-helper";

interface ConfigurationInput {
  role: McpConnectorRole;
  user: { document: McpConnectorDocument; revision: string };
  /** Captured execution target, never the sidebar selection or a copied worktree file. */
  project?: { document: McpConnectorDocument; projectId: string; revision: string };
  /** Trusted private state, not data supplied by the project document or browser. */
  approval?: { projectId: string; revision: string };
}

interface ResolvedConnector {
  /** Backend-only: never include this definition in ordinary snapshots. */
  definition: McpConnectorDefinition;
  status: McpConnectorConfigurationStatus;
}

interface ConfigurationResolution {
  blockedReason?: "role-excluded" | "project-required";
  connectors: readonly ResolvedConnector[];
}

/** Pure selection only. Eligibility does not establish credentials, health or authority. */
export function resolveMcpConnectors(input: ConfigurationInput): ConfigurationResolution {
  if (!["relay", "custom-assistant", "project-chat", "worker"].includes(input.role))
    return { blockedReason: "role-excluded", connectors: [] };
  if (input.role === "project-chat" && !input.project)
    return { blockedReason: "project-required", connectors: [] };

  const project = ["project-chat", "worker"].includes(input.role) ? input.project : undefined;
  const userSource: McpConnectorSource = { scope: "user", revision: input.user.revision };
  const projectSource: McpConnectorSource | undefined = project
    ? { scope: "project", projectId: project.projectId, revision: project.revision }
    : undefined;
  const approved =
    project !== undefined &&
    input.approval?.projectId === project.projectId &&
    input.approval.revision === project.revision;
  const ids = new Set([
    ...Object.keys(input.user.document.servers),
    ...Object.keys(project?.document.servers ?? {}),
  ]);
  return {
    connectors: [...ids].sort().map((id) => {
      const fromProject = project !== undefined && Object.hasOwn(project.document.servers, id);
      const definition = (
        fromProject ? project.document.servers[id] : input.user.document.servers[id]
      ) as McpConnectorDefinition;
      const approval = fromProject ? (approved ? "approved" : "required") : "not-required";
      return {
        // A detached copy prevents later callers from mutating the captured configuration.
        definition: structuredClone(definition),
        status: {
          id,
          label: definition.label,
          source: { ...(fromProject ? (projectSource as McpConnectorSource) : userSource) },
          shadowedSources:
            fromProject && Object.hasOwn(input.user.document.servers, id)
              ? [{ ...userSource }]
              : [],
          enabled: definition.enabled,
          approval,
          eligibility: !definition.enabled
            ? "disabled"
            : approval === "required"
              ? "approval-required"
              : "eligible",
        },
      };
    }),
  };
}
