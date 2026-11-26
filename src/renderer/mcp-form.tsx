import { useEffect, useId, useRef, useState } from "react";
import {
  MCP_TEXT_LIMITS,
  type McpConnectorDefinition,
  type McpConnectorDocument,
  parseMcpConnectorDocument,
  parseMcpDefinitionText,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Select, TextInput } from "./carbon/fields.js";
import { Textarea } from "./carbon/textarea.js";
import { ModalActions } from "./modal.js";

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
  clientIdType: "registered" | "metadata-url";
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
        key: randomId(),
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
    argIds: definition?.type === "stdio" ? definition.args.map(() => randomId()) : [],
    env: definition?.type === "stdio" ? bindings(definition.env) : [],
    url: definition?.type === "http" ? definition.url : "",
    headers: definition?.type === "http" ? bindings(definition.headers) : [],
    oauth: Boolean(auth),
    scopes: auth?.scopes.join("\n") ?? "",
    clientId: auth?.clientId ?? "",
    clientIdType: auth?.clientIdType ?? "registered",
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
                ...(fields.clientIdType === "metadata-url" ? { clientIdType: "metadata-url" } : {}),
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
          <TextInput
            labelText="Name"
            aria-label={`${title} name ${index + 1}`}
            value={row.name}
            maxLength={128}
            required
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
            }
          />
          <Select
            labelText="Binding"
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
          </Select>
          <TextInput
            labelText={row.kind === "literal" ? "Non-secret value" : "Credential reference"}
            aria-label={`${title} value ${index + 1}`}
            value={row.value}
            maxLength={row.kind === "literal" ? 8192 : 128}
            required={row.kind === "credential"}
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
          />
          {header && row.kind === "credential" && (
            <TextInput
              labelText="Prefix"
              aria-label={`${title} prefix ${index + 1}`}
              value={row.prefix}
              placeholder="Bearer "
              maxLength={8192}
              onChange={(e) =>
                onChange(rows.map((r, i) => (i === index ? { ...r, prefix: e.target.value } : r)))
              }
            />
          )}
          <Button
            variant="quiet"
            type="button"
            aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={rows.length >= 64}
        onClick={() =>
          onChange([...rows, { key: randomId(), name: "", kind: "literal", value: "", prefix: "" }])
        }
      >
        Add {header ? "header" : "environment binding"}
      </Button>
    </fieldset>
  );
}
export interface McpFormDraft {
  fields: McpFormFields;
  paste: string;
  pasteOpen: boolean;
  error: string;
}
export function McpForm({
  initial,
  draft,
  onDraft,
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
  draft?: McpFormDraft | undefined;
  onDraft?(draft: McpFormDraft): void;
  base: McpConnectorDocument;
  originalId?: string | undefined;
  templates: readonly { id: string; definition: McpConnectorDefinition }[];
  busy: boolean;
  stale: boolean;
  onSave(document: McpConnectorDocument): void;
  onCancel(): void;
  onReload(): void;
}) {
  const formId = useId();
  const [fields, setFields] = useState(draft?.fields ?? initial);
  const [paste, setPaste] = useState(draft?.paste ?? "");
  const [pasteOpen, setPasteOpen] = useState(draft?.pasteOpen ?? false);
  const [error, setError] = useState(draft?.error ?? "");
  const persist = useRef(onDraft);
  persist.current = onDraft;
  useEffect(() => {
    persist.current?.({ fields, paste, pasteOpen, error });
  }, [fields, paste, pasteOpen, error]);
  const change = <K extends keyof McpFormFields>(key: K, value: McpFormFields[K]) =>
    setFields((f) => ({
      ...f,
      [key]: value,
      ...(key === "args" && Array.isArray(value) && value.length !== f.argIds.length
        ? { argIds: value.map(() => randomId()) }
        : {}),
    }));
  let document: McpConnectorDocument | undefined;
  try {
    document = mcpFormDocument(fields, base, originalId);
  } catch {
    document = undefined;
  }
  return (
    <form
      id={formId}
      className="mcp-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (document && !busy && !stale) onSave(document);
      }}
    >
      <fieldset disabled={busy}>
        {!originalId && (
          <>
            <Select
              labelText="Starting definition"
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
            </Select>
            <Button type="button" onClick={() => setPasteOpen((v) => !v)}>
              Paste definition
            </Button>
            {pasteOpen && (
              <>
                <Textarea
                  labelText="Server definition"
                  hideLabel={false}
                  aria-label="Server definition"
                  rows={5}
                  maxLength={1_048_576}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <Button
                  variant="neutral"
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
                </Button>
              </>
            )}
          </>
        )}
        <TextInput
          labelText="Server ID"
          aria-label="Server ID"
          value={fields.id}
          disabled={Boolean(originalId)}
          required
          maxLength={64}
          placeholder="documentation"
          onChange={(e) => change("id", e.target.value)}
        />
        <TextInput
          labelText="Label"
          aria-label="Label"
          value={fields.label}
          required
          maxLength={120}
          onChange={(e) => change("label", e.target.value)}
        />
        <Select
          labelText="Transport"
          aria-label="Transport"
          value={fields.type}
          onChange={(e) => change("type", e.target.value as "stdio" | "http")}
        >
          <option value="stdio">Standard input/output</option>
          <option value="http">Streamable HTTP</option>
        </Select>
        {fields.type === "stdio" ? (
          <>
            <TextInput
              labelText="Command"
              aria-label="Command"
              value={fields.command}
              required
              maxLength={4096}
              placeholder="node"
              onChange={(e) => change("command", e.target.value)}
            />
            <fieldset className="settings-group">
              <legend>Arguments</legend>
              {fields.args
                .map((arg, index) => ({ arg, i: index, key: fields.argIds[index] }))
                .map(({ arg, i, key }) => (
                  <div className="mcp-binding" key={key}>
                    <TextInput
                      labelText={<>Argument {i + 1}</>}
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
                    <Button
                      variant="quiet"
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
                    </Button>
                  </div>
                ))}
              <Button
                type="button"
                disabled={fields.args.length >= 128}
                onClick={() => change("args", [...fields.args, ""])}
              >
                Add argument
              </Button>
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
            <TextInput
              labelText="URL"
              aria-label="URL"
              value={fields.url}
              required
              maxLength={4096}
              placeholder="https://example.com/mcp"
              onChange={(e) => change("url", e.target.value)}
            />
            <BindingFields
              title="Headers"
              rows={fields.headers}
              header
              onChange={(rows) => change("headers", rows)}
            />
            <Select
              labelText="Authentication"
              aria-label="Authentication"
              value={fields.oauth ? "oauth" : "none"}
              onChange={(e) => change("oauth", e.target.value === "oauth")}
            >
              <option value="none">None / header bindings</option>
              <option value="oauth">OAuth registration metadata</option>
            </Select>
            {fields.oauth && (
              <>
                <Textarea
                  labelText="Requested scopes (one per line)"
                  hideLabel={false}
                  aria-label="Requested scopes"
                  value={fields.scopes}
                  maxLength={16447}
                  onChange={(e) => change("scopes", e.target.value)}
                />
                <TextInput
                  labelText="Client ID (optional)"
                  aria-label="Client ID"
                  value={fields.clientId}
                  maxLength={4096}
                  onChange={(e) => change("clientId", e.target.value)}
                />
                <Select
                  labelText="Client ID type"
                  aria-label="Client ID type"
                  value={fields.clientIdType}
                  onChange={(event) =>
                    change(
                      "clientIdType",
                      event.target.value === "metadata-url" ? "metadata-url" : "registered",
                    )
                  }
                >
                  <option value="registered">Pre-registered client ID</option>
                  <option value="metadata-url">User-hosted HTTPS client metadata URL</option>
                </Select>
                <TextInput
                  labelText="Client secret reference (optional)"
                  aria-label="Client secret reference"
                  value={fields.clientSecretRef}
                  maxLength={128}
                  onChange={(e) => change("clientSecretRef", e.target.value)}
                />
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {stale && (
          <p role="alert">
            This configuration or project changed. Reload before saving. Your draft is retained.
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="quiet" type="button" onClick={onReload}>
            Reload and discard draft
          </Button>
          <ModalActions>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              form={formId}
              type="submit"
              disabled={busy || !document || stale}
            >
              Save server
            </Button>
          </ModalActions>
        </div>
      </fieldset>
    </form>
  );
}
