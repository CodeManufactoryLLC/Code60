import { useState } from "react";
import {
  MCP_TEXT_LIMITS,
  type McpConnectorDefinition,
  type McpConnectorDocument,
  parseMcpConnectorDocument,
  parseMcpDefinitionText,
} from "../bridge/index.js";

type Binding = {
  key: string;
  name: string;
  kind: "literal" | "credential";
  value: string;
  prefix: string;
};
export interface McpFormFields {
  id: string;
  label: string;
  type: "stdio" | "http";
  command: string;
  args: string[];
  argIds: string[];
  env: Binding[];
  url: string;
  headers: Binding[];
  oauth: boolean;
  scopes: string;
  clientId: string;
  clientSecretRef: string;
}
export function mcpFormFields(id: string, definition?: McpConnectorDefinition): McpFormFields {
  const bindings = (
    values: Record<
      string,
      { value: string } | { credentialRef: string; prefix?: string | undefined }
    >,
  ) =>
    Object.entries(values).map(
      ([name, b]): Binding => ({
        key: crypto.randomUUID(),
        name,
        kind: "value" in b ? "literal" : "credential",
        value: "value" in b ? b.value : b.credentialRef,
        prefix: "prefix" in b ? (b.prefix ?? "") : "",
      }),
    );
  const auth =
    definition?.type === "http" && definition.auth.type === "oauth" ? definition.auth : undefined;
  return {
    id,
    label: definition?.label ?? "",
    type: definition?.type ?? "stdio",
    command: definition?.type === "stdio" ? definition.command : "",
    args: definition?.type === "stdio" ? [...definition.args] : [],
    argIds: definition?.type === "stdio" ? definition.args.map(() => crypto.randomUUID()) : [],
    env: definition?.type === "stdio" ? bindings(definition.env) : [],
    url: definition?.type === "http" ? definition.url : "",
    headers: definition?.type === "http" ? bindings(definition.headers) : [],
    oauth: Boolean(auth),
    scopes: auth?.scopes.join("\n") ?? "",
    clientId: auth?.clientId ?? "",
    clientSecretRef: auth?.clientSecretRef ?? "",
  };
}
export function mcpFormDocument(
  fields: McpFormFields,
  base: McpConnectorDocument,
  originalId?: string,
): McpConnectorDocument {
  if (!originalId && Object.hasOwn(base.servers, fields.id))
    throw new Error("This server ID already exists.");
  const map = (rows: Binding[], header: boolean) => {
    if (new Set(rows.map((r) => (header ? r.name.toLowerCase() : r.name))).size !== rows.length)
      throw new Error("Binding names must be unique.");
    return Object.fromEntries(
      rows.map((r) => [
        r.name,
        r.kind === "literal"
          ? { value: r.value }
          : { credentialRef: r.value, ...(header && r.prefix ? { prefix: r.prefix } : {}) },
      ]),
    );
  };
  const common = {
    label: fields.label,
    enabled: originalId ? (base.servers[originalId]?.enabled ?? false) : false,
  };
  const definition =
    fields.type === "stdio"
      ? {
          ...common,
          type: "stdio",
          command: fields.command,
          args: fields.args,
          env: map(fields.env, false),
        }
      : {
          ...common,
          type: "http",
          url: fields.url,
          headers: map(fields.headers, true),
          auth: fields.oauth
            ? {
                type: "oauth",
                scopes: fields.scopes
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                ...(fields.clientId ? { clientId: fields.clientId } : {}),
                ...(fields.clientSecretRef ? { clientSecretRef: fields.clientSecretRef } : {}),
              }
            : { type: "none" },
        };
  const document = parseMcpConnectorDocument({
    version: 1,
    servers: { ...base.servers, [originalId ?? fields.id]: definition },
  });
  if (
    new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`).length >
    MCP_TEXT_LIMITS.bytes
  )
    throw new Error("Configuration exceeds the 1 MiB UTF-8 limit.");
  return document;
}
function BindingFields({
  title,
  rows,
  header,
  onChange,
}: {
  title: string;
  rows: Binding[];
  header: boolean;
  onChange(rows: Binding[]): void;
}) {
  return (
    <fieldset className="settings-group">
      <legend>{title}</legend>
      {rows.map((row, index) => (
        <div className="mcp-binding" key={row.key}>
          <label>
            Name
            <input
              aria-label={`${title} name ${index + 1}`}
              value={row.name}
              maxLength={128}
              required
              onChange={(e) =>
                onChange(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
              }
            />
          </label>
          <label>
            Binding
            <select
              aria-label={`${title} binding ${index + 1}`}
              value={row.kind}
              onChange={(e) =>
                onChange(
                  rows.map((r, i) =>
                    i === index ? { ...r, kind: e.target.value as Binding["kind"], value: "" } : r,
                  ),
                )
              }
            >
              <option value="literal">Non-secret literal</option>
              <option value="credential">Credential reference</option>
            </select>
          </label>
          <label>
            {row.kind === "literal" ? "Non-secret value" : "Credential reference"}
            <input
              aria-label={`${title} value ${index + 1}`}
              value={row.value}
              maxLength={row.kind === "literal" ? 8192 : 128}
              required={row.kind === "credential"}
              onChange={(e) =>
                onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
              }
            />
          </label>
          {header && row.kind === "credential" && (
            <label>
              Prefix
              <input
                aria-label={`${title} prefix ${index + 1}`}
                value={row.prefix}
                placeholder="Bearer "
                maxLength={8192}
                onChange={(e) =>
                  onChange(rows.map((r, i) => (i === index ? { ...r, prefix: e.target.value } : r)))
                }
              />
            </label>
          )}
          <button
            type="button"
            aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={rows.length >= 64}
        onClick={() =>
          onChange([
            ...rows,
            { key: crypto.randomUUID(), name: "", kind: "literal", value: "", prefix: "" },
          ])
        }
      >
        Add {header ? "header" : "environment binding"}
      </button>
    </fieldset>
  );
}
export function McpForm({
  initial,
  base,
  originalId,
  templates,
  busy,
  stale,
  onSave,
  onCancel,
  onReload,
}: {
  initial: McpFormFields;
  base: McpConnectorDocument;
  originalId?: string | undefined;
  templates: readonly { id: string; definition: McpConnectorDefinition }[];
  busy: boolean;
  stale: boolean;
  onSave(document: McpConnectorDocument): void;
  onCancel(): void;
  onReload(): void;
}) {
  const [fields, setFields] = useState(initial);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [error, setError] = useState("");
  const change = <K extends keyof McpFormFields>(key: K, value: McpFormFields[K]) =>
    setFields((f) => ({
      ...f,
      [key]: value,
      ...(key === "args" && Array.isArray(value) && value.length !== f.argIds.length
        ? { argIds: value.map(() => crypto.randomUUID()) }
        : {}),
    }));
  let document: McpConnectorDocument | undefined;
  let problem = "";
  try {
    document = mcpFormDocument(fields, base, originalId);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : "Invalid MCP server definition.";
  }
  return (
    <form
      className="mcp-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (document && !busy && !stale) onSave(document);
      }}
    >
      <fieldset disabled={busy}>
        {!originalId && (
          <>
            <label>
              Starting definition
              <select
                aria-label="Starting definition"
                defaultValue="blank"
                onChange={(e) => {
                  const template = templates.find((t) => t.id === e.target.value);
                  setFields(mcpFormFields(template?.id ?? "", template?.definition));
                }}
              >
                <option value="blank">Blank</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.definition.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setPasteOpen((v) => !v)}>
              Paste definition
            </button>
            {pasteOpen && (
              <>
                <label>
                  Server definition
                  <textarea
                    aria-label="Server definition"
                    rows={5}
                    maxLength={1_048_576}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setFields(mcpFormFields(fields.id, parseMcpDefinitionText(paste)));
                      setError("");
                      setPasteOpen(false);
                      setPaste("");
                    } catch {
                      setError(
                        "Invalid MCP server definition. Paste one version-one server object with label, enabled and transport fields.",
                      );
                    }
                  }}
                >
                  Review definition
                </button>
              </>
            )}
          </>
        )}
        <label>
          Server ID
          <input
            aria-label="Server ID"
            value={fields.id}
            disabled={Boolean(originalId)}
            required
            maxLength={64}
            placeholder="documentation"
            onChange={(e) => change("id", e.target.value)}
          />
        </label>
        <label>
          Label
          <input
            aria-label="Label"
            value={fields.label}
            required
            maxLength={120}
            onChange={(e) => change("label", e.target.value)}
          />
        </label>
        <label>
          Transport
          <select
            aria-label="Transport"
            value={fields.type}
            onChange={(e) => change("type", e.target.value as "stdio" | "http")}
          >
            <option value="stdio">Standard input/output</option>
            <option value="http">Streamable HTTP</option>
          </select>
        </label>
        {fields.type === "stdio" ? (
          <>
            <label>
              Command
              <input
                aria-label="Command"
                value={fields.command}
                required
                maxLength={4096}
                placeholder="node"
                onChange={(e) => change("command", e.target.value)}
              />
            </label>
            <fieldset className="settings-group">
              <legend>Arguments</legend>
              {fields.args
                .map((arg, index) => ({ arg, i: index, key: fields.argIds[index] }))
                .map(({ arg, i, key }) => (
                  <div className="mcp-binding" key={key}>
                    <label>
                      Argument {i + 1}
                      <input
                        aria-label={`Argument ${i + 1}`}
                        value={arg}
                        maxLength={4096}
                        onChange={(e) =>
                          change(
                            "args",
                            fields.args.map((v, n) => (n === i ? e.target.value : v)),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove argument ${i + 1}`}
                      onClick={() =>
                        change(
                          "args",
                          fields.args.filter((_, n) => n !== i),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              <button
                type="button"
                disabled={fields.args.length >= 128}
                onClick={() => change("args", [...fields.args, ""])}
              >
                Add argument
              </button>
            </fieldset>
            <BindingFields
              title="Environment"
              rows={fields.env}
              header={false}
              onChange={(rows) => change("env", rows)}
            />
          </>
        ) : (
          <>
            <label>
              URL
              <input
                aria-label="URL"
                value={fields.url}
                required
                maxLength={4096}
                placeholder="https://example.com/mcp"
                onChange={(e) => change("url", e.target.value)}
              />
            </label>
            <BindingFields
              title="Headers"
              rows={fields.headers}
              header
              onChange={(rows) => change("headers", rows)}
            />
            <label>
              Authentication
              <select
                aria-label="Authentication"
                value={fields.oauth ? "oauth" : "none"}
                onChange={(e) => change("oauth", e.target.value === "oauth")}
              >
                <option value="none">None / header bindings</option>
                <option value="oauth">OAuth registration metadata</option>
              </select>
            </label>
            {fields.oauth && (
              <>
                <label>
                  Requested scopes (one per line)
                  <textarea
                    aria-label="Requested scopes"
                    value={fields.scopes}
                    maxLength={16447}
                    onChange={(e) => change("scopes", e.target.value)}
                  />
                </label>
                <label>
                  Client ID (optional)
                  <input
                    aria-label="Client ID"
                    value={fields.clientId}
                    maxLength={4096}
                    onChange={(e) => change("clientId", e.target.value)}
                  />
                </label>
                <label>
                  Client secret reference (optional)
                  <input
                    aria-label="Client secret reference"
                    value={fields.clientSecretRef}
                    maxLength={128}
                    onChange={(e) => change("clientSecretRef", e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        <p>
          Credential references are unverified. Credentials are not stored, resolved or copied here.
          Use literals only for non-secret values.
        </p>
        <p>
          {originalId
            ? "The existing enabled state is preserved."
            : "New servers are saved disabled."}{" "}
          Saving does not launch or connect a server. Launch commands such as npx may download
          packages when runtime support is added.
        </p>
        {error && <p role="alert">{error}</p>}
        {problem && (
          <p role="status">
            {problem} Use a lowercase alphanumeric/hyphen ID, valid transport fields and explicit
            non-secret or credential bindings.
          </p>
        )}
        {stale && (
          <p role="alert">
            This configuration or project changed. Reload before saving. Your draft is retained.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onReload}>
            Reload and discard draft
          </button>
          <button type="submit" disabled={!document || stale}>
            Save server
          </button>
        </div>
      </fieldset>
    </form>
  );
}
