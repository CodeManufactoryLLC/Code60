import { z } from "zod";

// This module is also imported directly: never probe eval under the renderer CSP.
z.config({ jitless: true });

export const MCP_CONNECTOR_LIMITS = {
  servers: 64,
  id: 64,
  label: 120,
  launch: 4096,
  arguments: 128,
  bindings: 64,
  bindingName: 128,
  value: 8192,
  credentialRef: 128,
  scopes: 64,
  scope: 256,
} as const;

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes("\0"));
const nonempty = (max: number) => text(max).refine((value) => value.trim().length > 0);
const credentialRef = nonempty(MCP_CONNECTOR_LIMITS.credentialRef);
const literal = z.strictObject({ value: text(MCP_CONNECTOR_LIMITS.value) });
const secret = z.strictObject({ credentialRef });
const headerSecret = z.strictObject({
  credentialRef,
  prefix: text(MCP_CONNECTOR_LIMITS.value).optional(),
});
const environmentName = nonempty(MCP_CONNECTOR_LIMITS.bindingName).refine(
  (value) => !value.includes("="),
);
const headerName = z
  .string()
  .max(MCP_CONNECTOR_LIMITS.bindingName)
  .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/i);
// Zod records deliberately skip this key. Reject it before parsing rather than silently losing data.
const recordInput = z
  .unknown()
  .refine(
    (value) => value === null || typeof value !== "object" || !Object.hasOwn(value, "__proto__"),
  );
const env = recordInput
  .pipe(z.record(environmentName, z.union([literal, secret])))
  .refine((value) => Object.keys(value).length <= MCP_CONNECTOR_LIMITS.bindings);
const headers = recordInput
  .pipe(z.record(headerName, z.union([literal, headerSecret])))
  .refine((value) => Object.keys(value).length <= MCP_CONNECTOR_LIMITS.bindings)
  .refine((value) =>
    Object.keys(value).every(
      (name) =>
        ![
          "host",
          "connection",
          "content-length",
          "content-type",
          "accept",
          "mcp-session-id",
          "mcp-protocol-version",
          "last-event-id",
          "transfer-encoding",
          "upgrade",
          "origin",
          "mcp-method",
          "keep-alive",
          "te",
          "trailer",
          "proxy-connection",
          "proxy-authorization",
          "proxy-authenticate",
        ].includes(name.toLowerCase()),
    ),
  )
  .refine((value) => {
    const names = Object.keys(value).map((name) => name.toLowerCase());
    return new Set(names).size === names.length;
  })
  .refine((value) =>
    Object.entries(value).every(
      ([name, binding]) =>
        !["authorization", "proxy-authorization"].includes(name.toLowerCase()) ||
        "credentialRef" in binding,
    ),
  )
  .refine((value) =>
    Object.values(value).every(
      (binding) =>
        ("value" in binding ? binding.value : (binding.prefix ?? "")).match(/[\r\n]/) === null,
    ),
  );
const url = nonempty(MCP_CONNECTOR_LIMITS.launch).refine((value) => {
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
});
const auth = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({
    type: z.literal("oauth"),
    scopes: z
      .array(
        nonempty(MCP_CONNECTOR_LIMITS.scope).refine((value) =>
          /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(value),
        ),
      )
      .max(MCP_CONNECTOR_LIMITS.scopes)
      .default([]),
    clientId: nonempty(MCP_CONNECTOR_LIMITS.launch).optional(),
    clientIdType: z.enum(["registered", "metadata-url"]).optional(),
    clientSecretRef: credentialRef.optional(),
  }),
]);
const common = {
  label: nonempty(MCP_CONNECTOR_LIMITS.label),
  enabled: z.boolean(),
};
const definition = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...common,
      type: z.literal("stdio"),
      command: nonempty(MCP_CONNECTOR_LIMITS.launch),
      args: z
        .array(text(MCP_CONNECTOR_LIMITS.launch))
        .max(MCP_CONNECTOR_LIMITS.arguments)
        .default([]),
      env: env.default({}),
    }),
    z.strictObject({
      ...common,
      type: z.literal("http"),
      url,
      headers: headers.default({}),
      auth: auth.default({ type: "none" }),
    }),
  ])
  .refine(
    (server) =>
      server.type !== "http" ||
      server.auth.type !== "oauth" ||
      (!Object.keys(server.headers).some((name) => name.toLowerCase() === "authorization") &&
        !Object.values(server.headers).some(
          (binding) =>
            "credentialRef" in binding &&
            binding.credentialRef ===
              (server.auth.type === "oauth" ? server.auth.clientSecretRef : undefined),
        )),
  )
  .refine((server) => {
    if (
      server.type !== "http" ||
      server.auth.type !== "oauth" ||
      server.auth.clientIdType !== "metadata-url"
    )
      return true;
    try {
      const client = new URL(server.auth.clientId ?? "");
      return (
        client.protocol === "https:" &&
        client.pathname !== "/" &&
        !client.username &&
        !client.password &&
        !client.hash &&
        !server.auth.clientSecretRef
      );
    } catch {
      return false;
    }
  });

export const mcpConnectorDocumentSchema = z.strictObject({
  version: z.literal(1),
  servers: recordInput
    .pipe(
      z.record(
        z
          .string()
          .max(MCP_CONNECTOR_LIMITS.id)
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .refine((id) => id !== "code60"),
        definition,
      ),
    )
    .refine((servers) => Object.keys(servers).length <= MCP_CONNECTOR_LIMITS.servers),
});

export type McpConnectorDocument = z.infer<typeof mcpConnectorDocumentSchema>;
export type McpConnectorDefinition = McpConnectorDocument["servers"][string];

/** Parse an already decoded document. Text size and duplicate keys belong to the loader. */
export function parseMcpConnectorDocument(value: unknown): McpConnectorDocument {
  const result = mcpConnectorDocumentSchema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid MCP connector configuration");
  return result.data;
}

/** Opaque identity/revision metadata, never paths, credentials or launch definitions. */
export type McpConnectorSource =
  | { scope: "user"; revision: string }
  | { scope: "project"; projectId: string; revision: string };

export interface McpConnectorConfigurationStatus {
  id: string;
  label: string;
  source: McpConnectorSource;
  shadowedSources: readonly McpConnectorSource[];
  enabled: boolean;
  approval: "not-required" | "required" | "approved";
  eligibility: "eligible" | "disabled" | "approval-required";
  observation?: McpConnectorObservation;
}

/** Observations are independent of configuration eligibility; absence means not checked. */
interface McpConnectorObservation {
  authentication: "not-checked" | "not-required" | "required" | "authenticated" | "failed";
  connection:
    | "not-tested"
    | "connecting"
    | "connected"
    | "failed"
    | "unsupported"
    | "disconnected"
    | "cleanup-unresolved";
  observedAt?: string;
  sessionId?: string;
  provider?: string;
}
